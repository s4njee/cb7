/**
 * @module
 * DAO for the `scan_jobs` progress mirror.
 *
 * The durable queue lives in pg-boss; this table is the small, human-facing
 * progress record the web UI polls (`GET /api/jobs/:id`). Rows are keyed by the
 * pg-boss job id. Both the API (at enqueue time, so the client can poll
 * immediately) and the worker (defensively, for jobs enqueued outside an HTTP
 * request, e.g. the auto-rescan) upsert here — hence the ON CONFLICT DO NOTHING.
 *
 * Follows the repo convention: free functions taking a {@link Db} first arg with
 * SQLite-style `?` placeholders (rewritten to `$n` by the pg helper).
 */
import { type Db, NOW_TEXT_SQL } from './pg';

export type ScanJobStatus = 'queued' | 'active' | 'done' | 'failed';

/** Camel-cased scan job as returned to the API. */
export interface ScanJob {
  id: string;
  kind: string;
  status: ScanJobStatus;
  targetPath: string | null;
  folderId: number | null;
  discovered: number;
  processed: number;
  added: number;
  /** Files rejected as byte-identical duplicates during the scan. */
  duplicates: number;
  currentFile: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ScanJobRow {
  id: string;
  kind: string;
  status: string;
  target_path: string | null;
  folder_id: number | null;
  discovered: number;
  processed: number;
  added: number;
  duplicates: number;
  current_file: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(r: ScanJobRow): ScanJob {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status as ScanJobStatus,
    targetPath: r.target_path,
    folderId: r.folder_id,
    discovered: r.discovered,
    processed: r.processed,
    added: r.added,
    duplicates: r.duplicates,
    currentFile: r.current_file,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Create the progress row for a job, if it doesn't already exist. Idempotent so
 * the API and the worker can both call it for the same job id.
 */
export async function createScanJob(
  db: Db,
  input: { id: string; kind: string; targetPath?: string | null; folderId?: number | null },
): Promise<void> {
  await db.run(
    `INSERT INTO scan_jobs (id, kind, status, target_path, folder_id)
     VALUES (?, ?, 'queued', ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [input.id, input.kind, input.targetPath ?? null, input.folderId ?? null],
  );
}

export interface ScanProgressPatch {
  status?: ScanJobStatus;
  discovered?: number;
  processed?: number;
  added?: number;
  duplicates?: number;
  currentFile?: string | null;
  error?: string | null;
}

/** Patch a job's progress/status. Always bumps `updated_at`. */
export async function updateScanProgress(db: Db, id: string, patch: ScanProgressPatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, val: unknown): void => {
    sets.push(`${col} = ?`);
    params.push(val);
  };
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.discovered !== undefined) set('discovered', patch.discovered);
  if (patch.processed !== undefined) set('processed', patch.processed);
  if (patch.added !== undefined) set('added', patch.added);
  if (patch.duplicates !== undefined) set('duplicates', patch.duplicates);
  if (patch.currentFile !== undefined) set('current_file', patch.currentFile);
  if (patch.error !== undefined) set('error', patch.error);
  // NOW_TEXT_SQL has no bind params, so placeholder ordering is preserved.
  sets.push(`updated_at = ${NOW_TEXT_SQL}`);
  params.push(id);
  await db.run(`UPDATE scan_jobs SET ${sets.join(', ')} WHERE id = ?`, params);
}

/** Fetch one job's progress, or undefined if unknown. */
export async function getScanJob(db: Db, id: string): Promise<ScanJob | undefined> {
  const row = await db.get<ScanJobRow>('SELECT * FROM scan_jobs WHERE id = ?', [id]);
  return row ? mapRow(row) : undefined;
}

/** The most recent in-flight (queued/active) jobs, newest first. */
export async function listActiveScanJobs(db: Db, limit = 50): Promise<ScanJob[]> {
  const rows = await db.all<ScanJobRow>(
    `SELECT * FROM scan_jobs WHERE status IN ('queued','active') ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(mapRow);
}

/**
 * The most recent in-flight job for a path — used to resolve the existing job id
 * when an enqueue was deduped (pg-boss `send` returned null).
 */
export async function findActiveScanByPath(db: Db, targetPath: string): Promise<ScanJob | undefined> {
  const row = await db.get<ScanJobRow>(
    `SELECT * FROM scan_jobs WHERE target_path = ? AND status IN ('queued','active')
      ORDER BY created_at DESC LIMIT 1`,
    [targetPath],
  );
  return row ? mapRow(row) : undefined;
}

/**
 * The newest `scan_jobs` row per folder — the status source for the watched-roots
 * list (one query, not N+1). Covers both the active job (queued/active) and the
 * last terminal outcome (done/failed + error), since `scan_jobs` is append-only
 * history. `created_at` is fixed-width UTC text, so `ORDER BY created_at DESC`
 * is a correct newest-first sort.
 * @param folderIds The folders to look up.
 * @returns A map of `folderId → newest ScanJob` for folders that have any jobs.
 */
export async function getLatestScanJobForFolders(db: Db, folderIds: number[]): Promise<Map<number, ScanJob>> {
  const ids = Array.from(new Set(folderIds));
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all<ScanJobRow>(
    `SELECT DISTINCT ON (folder_id) *
     FROM scan_jobs
     WHERE folder_id IN (${placeholders})
     ORDER BY folder_id, created_at DESC`,
    ids,
  );
  return new Map(rows.map((row) => [row.folder_id as number, mapRow(row)]));
}

/** One queue's in-flight (not yet completed) counts, for the admin UI. */
export interface QueueCounts {
  depth: number;
  perQueue: Array<{ name: string; queued: number; active: number }>;
}

/**
 * Live depth of the pg-boss queue, grouped per queue. Reads pg-boss's own
 * `pgboss.job` table — the durable queue we *don't* own, so this is a read-only
 * peek, never a write. States: `created`/`retry` = queued (waiting for a
 * worker), `active` = leased by a worker and running.
 */
export async function getQueueStatus(db: Db): Promise<QueueCounts> {
  try {
    const rows = await db.all<{ name: string; state: string; cnt: number }>(
      `SELECT name, state, count(*) AS cnt FROM pgboss.job
       WHERE state IN ('created', 'retry', 'active')
       GROUP BY name, state`,
    );
    const byQueue = new Map<string, { queued: number; active: number }>();
    let depth = 0;
    for (const row of rows) {
      const entry = byQueue.get(row.name) ?? { queued: 0, active: 0 };
      if (row.state === 'active') entry.active += row.cnt;
      else entry.queued += row.cnt;
      byQueue.set(row.name, entry);
      depth += row.cnt;
    }
    return {
      depth,
      perQueue: [...byQueue.entries()].map(([name, counts]) => ({ name, ...counts })),
    };
  } catch {
    // pg-boss's own schema may not exist yet (first boot, or the API started
    // before pg-boss finished creating it) — report zero rather than 500.
    return { depth: 0, perQueue: [] };
  }
}
