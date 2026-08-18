/**
 * @module
 * Periodic Incremental Rescan of Watched Library Roots
 *
 * Architecture overview for Junior Devs:
 * If a user drops files into a watched library root on disk, the library won't
 * know until it rescans. This scheduler does that automatically on an interval
 * read from `auto_rescan_interval_min` in `app_meta` (0 disables it).
 *
 * It walks only folders with a registered `scan_path` (watched roots) whose
 * `auto_scan_enabled` flag is on — plain virtual collections are never scanned.
 * Each root's stored path is used directly, so empty / brand-new drop folders
 * are valid watch targets.
 *
 * Key design choice: instead of a fixed `setInterval`, it schedules the *next*
 * run only after the current one finishes (via `setTimeout`). That guarantees
 * two scans never overlap, even if one takes longer than the interval. It reuses
 * the same scan-timestamp the manual rescan route writes, so manual and
 * scheduled rescans share one incremental state.
 *
 * The actual scanning is injected via {@link FolderScanFn}: in the worker
 * process this *enqueues* a durable `ingest-scan` job per root rather than
 * scanning inline, so a long auto-rescan survives restarts like any other job.
 */
import * as fs from 'node:fs';
import { createLogger } from './logger';
import type { LibraryDatabase } from './libraryDatabase';

const log = createLogger('folderScheduler');

export const AUTO_RESCAN_INTERVAL_KEY = 'auto_rescan_interval_min';

/** What the scheduler hands its injected action for each due watched root. */
export interface FolderScanRequest {
  folderId: number;
  folderName: string;
  /** The folder's registered scan root (its `scan_path`). */
  scanPath: string;
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
      const roots = (await this.db.getWatchedRoots()).filter((r) => r.autoScanEnabled);
      for (const root of roots) {
        if (this.stopped) break;
        if (!fs.existsSync(root.scanPath)) {
          // Missing mount (NFS down, path removed) — skip loudly in the log, the
          // admin roots surface reports the same via `pathExists`.
          log.warn(`Watched root "${root.name}" (${root.id}) path ${root.scanPath} missing, skipping`);
          continue;
        }

        const lastScanRaw = await this.db.getAppMeta(`folder_scan_ts:${root.id}`);
        const since = lastScanRaw ? parseInt(lastScanRaw, 10) : undefined;
        const scanStartMs = Date.now();

        try {
          await this.runScan({
            folderId: root.id,
            folderName: root.name,
            scanPath: root.scanPath,
            since,
            scanStartMs,
          });
        } catch (err) {
          log.error(`Auto-rescan enqueue failed for watched root "${root.name}":`, err);
        }
      }
    } finally {
      this.running = false;
      log.info('Auto-rescan complete');
    }
  }
}
