/**
 * @module
 * Periodic Incremental Rescan of Watched Folders
 *
 * Architecture overview for Junior Devs:
 * If a user adds files to a watched folder on disk, the library won't know until
 * it rescans. This scheduler does that automatically on an interval read from
 * `auto_rescan_interval_min` in `app_meta` (0 disables it).
 *
 * Key design choice: instead of a fixed `setInterval`, it schedules the *next*
 * run only after the current one finishes (via `setTimeout`). That guarantees
 * two scans never overlap, even if one takes longer than the interval. It reuses
 * the same scan-timestamp the manual rescan route writes, so manual and
 * scheduled rescans share one incremental state.
 *
 * The actual scanning is injected via {@link FolderScanFn}: in the worker
 * process this *enqueues* a durable `ingest-scan` job per folder rather than
 * scanning inline, so a long auto-rescan survives restarts like any other job.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createLogger } from './logger';
import type { LibraryDatabase } from './libraryDatabase';

const log = createLogger('folderScheduler');

export const AUTO_RESCAN_INTERVAL_KEY = 'auto_rescan_interval_min';

/** What the scheduler hands its injected action for each due folder. */
export interface FolderScanRequest {
  folderId: number;
  folderName: string;
  /** Common ancestor directory of the folder's comics — the scan root. */
  commonDir: string;
  /** Unix ms of the last successful scan; undefined means full scan. */
  since?: number;
  /**
   * Snapshot of when this scan started. The action should arrange for this to be
   * persisted as `folder_scan_ts:<folderId>` once the scan succeeds, so the next
   * rescan resumes from here.
   */
  scanStartMs: number;
}

/** Per-folder action the scheduler invokes when a rescan is due. */
export type FolderScanFn = (req: FolderScanRequest) => Promise<void>;

/**
 * Drives the automatic, non-overlapping folder rescans.
 * Construct with the library database, then call `start()`. A
 * once-a-minute heartbeat picks up interval changes made via the API without a
 * restart.
 */
export class FolderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(private db: LibraryDatabase, private runScan: FolderScanFn) {}

  /** Read the configured interval in minutes (0 means disabled). */
  async getIntervalMin(): Promise<number> {
    const raw = await this.db.getAppMeta(AUTO_RESCAN_INTERVAL_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** Begin scheduling rescans and start the interval-change heartbeat. */
  start(): void {
    this.stopped = false;
    void this.reschedule();
    // Poll every minute so that enabling the interval via the API takes
    // effect without needing a server restart.
    this.heartbeat = setInterval(() => {
      if (!this.timer && !this.running && !this.stopped) void this.reschedule();
    }, 60_000);
  }

  /** Stop all scheduling and clear pending timers (e.g. on shutdown). */
  stop(): void {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
  }

  private async reschedule(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.stopped) return;
    const intervalMin = await this.getIntervalMin();
    if (this.stopped || intervalMin <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.runOnce().finally(() => void this.reschedule());
    }, intervalMin * 60 * 1000);
  }

  private async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    log.info('Auto-rescan starting');
    try {
      const folders = await this.db.getAllFolders();
      for (const folder of folders) {
        if (this.stopped) break;
        const filePaths = await this.db.getFolderFilePaths(folder.id);
        if (filePaths.length === 0) continue;

        const dirs = filePaths.map((p) => path.dirname(p));
        const commonDir = findCommonDir(dirs);
        if (!commonDir) {
          log.warn(`Folder "${folder.name}" (${folder.id}) spans multiple roots, skipping`);
          continue;
        }
        if (!fs.existsSync(commonDir)) {
          log.warn(`Folder "${folder.name}" path ${commonDir} no longer exists, skipping`);
          continue;
        }

        const lastScanRaw = await this.db.getAppMeta(`folder_scan_ts:${folder.id}`);
        const since = lastScanRaw ? parseInt(lastScanRaw, 10) : undefined;
        const scanStartMs = Date.now();

        try {
          await this.runScan({ folderId: folder.id, folderName: folder.name, commonDir, since, scanStartMs });
        } catch (err) {
          log.error(`Auto-rescan enqueue failed for folder "${folder.name}":`, err);
        }
      }
    } finally {
      this.running = false;
      log.info('Auto-rescan complete');
    }
  }
}

function findCommonDir(dirs: string[]): string | null {
  if (dirs.length === 0) return null;
  let common = dirs[0];
  for (const dir of dirs.slice(1)) {
    while (dir !== common && !dir.startsWith(common + path.sep)) {
      const parent = path.dirname(common);
      if (parent === common) return null;
      common = parent;
    }
  }
  return common;
}
