/**
 * @module
 * DAO for the `ingest_errors` table — the persistent log of per-file ingest
 * failures (corrupt archive, missing file, extract timeout, …).
 *
 * Why a shared table and not a file: bulk ingest runs in the cb8-worker process
 * while the admin "ingest errors" panel is served by the API process. In k8s each
 * pod has its own emptyDir for CB8_DATA_DIR, so the previous JSONL store diverged
 * — the panel only ever saw the API pod's single-file upload errors and never the
 * worker's background-scan failures (the common case at 40k comics). A single
 * Postgres table lets the worker (writer) and the API (reader) agree.
 *
 * Writes are best-effort from the caller's point of view: recording a failure
 * must never abort an in-flight scan, so the ingest call sites swallow rejections
 * (see {@link LibraryDatabase} usage). These functions themselves throw on a real
 * DB error like any other DAO.
 *
 * Follows the repo convention: free functions taking a {@link Db} first arg with
 * SQLite-style `?` placeholders (rewritten to `$n` by the pg helper).
 */
import { type Db } from './pg';
import type { CountRow } from './types';
import type { IngestErrorClass } from '../ingestErrorLog';

/** One persisted ingest failure, in the camel-cased API/response shape. */
export interface IngestErrorRecord {
  ts: string;          // ISO-8601 timestamp (UTC)
  path: string;        // absolute file path
  ext: string;         // lowercased extension with leading dot, e.g. ".cbr"
  errorClass: IngestErrorClass;
  message: string;     // raw error message (trimmed)
}

/** The fields a caller supplies; `ts`/`id` are assigned by the DB. */
export interface NewIngestError {
  path: string;
  ext: string;
  errorClass: IngestErrorClass;
  message: string;
  /**
   * The pg-boss job id this failure belongs to (a scan job; matches
   * `scan_jobs.id`). NULL for API-side single-file errors. Stored in the TEXT
   * `job_id` column because pg-boss v12 job ids are UUID strings.
   */
  jobId?: number | string | null;
}

interface IngestErrorRow {
  file_path: string;
  ext: string;
  error_class: string;
  message: string;
  created_at: Date; // pg parses timestamptz into a JS Date
}

function mapRow(r: IngestErrorRow): IngestErrorRecord {
  return {
    ts: r.created_at.toISOString(),
    path: r.file_path,
    ext: r.ext,
    errorClass: r.error_class as IngestErrorClass,
    message: r.message,
  };
}

/** Append one failure record. `created_at` defaults to now() in the DB. */
export async function recordIngestError(db: Db, record: NewIngestError): Promise<void> {
  await db.run(
    'INSERT INTO ingest_errors (job_id, file_path, ext, error_class, message) VALUES (?, ?, ?, ?, ?)',
    [record.jobId ?? null, record.path, record.ext, record.errorClass, record.message],
  );
}

/**
 * The most recent failures, newest first. Orders by the monotonic `id` so ties
 * at the same timestamp keep insertion order.
 * @param limit Maximum number of records to return.
 */
export async function getRecentIngestErrors(db: Db, limit = 50): Promise<IngestErrorRecord[]> {
  const rows = await db.all<IngestErrorRow>(
    'SELECT file_path, ext, error_class, message, created_at FROM ingest_errors ORDER BY id DESC LIMIT ?',
    [limit],
  );
  return rows.map(mapRow);
}

/**
 * All failures recorded against one scan job, newest first (orders by the
 * monotonic `id` so ties at the same timestamp keep insertion order). Used by
 * `GET /api/jobs/:id` so the admin scan UI can list exactly which files a job
 * failed on.
 */
export async function getIngestErrorsForJob(db: Db, jobId: number | string): Promise<IngestErrorRecord[]> {
  const rows = await db.all<IngestErrorRow>(
    'SELECT file_path, ext, error_class, message, created_at FROM ingest_errors WHERE job_id = ? ORDER BY id DESC',
    [jobId],
  );
  return rows.map(mapRow);
}

/** Total number of recorded failures. */
export async function countIngestErrors(db: Db): Promise<number> {
  const row = await db.get<CountRow>('SELECT COUNT(*) AS cnt FROM ingest_errors');
  return row?.cnt ?? 0;
}

/** Remove all recorded failures. Wired to the admin DELETE endpoint. */
export async function clearIngestErrors(db: Db): Promise<void> {
  await db.run('DELETE FROM ingest_errors');
}
