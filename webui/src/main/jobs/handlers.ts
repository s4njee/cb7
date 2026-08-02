/**
 * @module
 * pg-boss job handlers, separated from the worker entry point so they can be
 * unit-tested directly (importing `worker.ts` would run its `main()`).
 *
 * Every handler is idempotent: a re-delivered job (after a crash/restart) must
 * not duplicate work. Ingest relies on `comicExistsByPath`; the backfill only
 * indexes books with no chunks. Progress is mirrored into the `scan_jobs` row
 * the web UI polls.
 */
import type { Job } from 'pg-boss';
import type { LibraryDatabase } from '../libraryDatabase';
import { createLogger } from '../logger';
import { ingestPathStreaming, type IngestEvent } from '../webServer/ingest';
import { getEpubSpineCount } from '../epubCoverExtractor';
import { withTimeout } from '../utils/timeout';
import { QUEUE, type IngestScanJob, type SearchBackfillJob } from './queues';
import { enqueueBackfill } from './producer';

const log = createLogger('jobs');

/** How often in-flight scan progress is flushed to the `scan_jobs` row. */
export const PROGRESS_FLUSH_MS = 750;

/**
 * Handle one ingest-scan job: run the existing scan, mirroring progress into the
 * `scan_jobs` row the web UI polls. Idempotent (existing files are skipped), so a
 * re-delivered job simply resumes. If the job is aborted (graceful shutdown or
 * lease expiry) we throw so pg-boss retries it rather than marking it complete.
 */
export async function handleIngestScan(db: LibraryDatabase, job: Job<IngestScanJob>): Promise<void> {
  const data = job.data;
  await db.createScanJob({ id: job.id, kind: QUEUE.ingestScan, targetPath: data.targetPath, folderId: data.folderId ?? null });
  await db.updateScanProgress(job.id, { status: 'active' });

  const progress = { discovered: 0, processed: 0, added: 0, currentFile: '' };
  let lastError: string | undefined;
  const emit = (event: IngestEvent): void => {
    if (event.type === 'progress') {
      progress.discovered = event.discovered;
      progress.processed = event.processed;
      progress.currentFile = event.currentFile;
    } else if (event.type === 'done') {
      progress.added = event.added;
    } else if (event.type === 'error') {
      lastError = event.message;
    }
  };

  // Throttled flush instead of a DB write per file (which at 40k would be 40k writes).
  const flush = setInterval(() => {
    void db
      .updateScanProgress(job.id, {
        discovered: progress.discovered,
        processed: progress.processed,
        added: progress.added,
        currentFile: progress.currentFile,
      })
      .catch(() => { /* progress is best-effort */ });
  }, PROGRESS_FLUSH_MS);

  try {
    await ingestPathStreaming(db, data.targetPath, emit, {
      folderId: data.folderId,
      useFolderNamesAsSeries: data.useFolderNamesAsSeries,
      since: data.since,
      signal: job.signal,
    });
    clearInterval(flush);

    // Aborted mid-run (shutdown / lease expiry): fail so pg-boss re-delivers and
    // the idempotent scan resumes, rather than completing a partial scan.
    if (job.signal.aborted) {
      throw new Error('ingest-scan aborted (shutdown/lease) — will resume on retry');
    }

    // Auto-rescan advances the incremental cursor only after a successful scan.
    if (data.folderId != null && data.scanMetaTs != null) {
      await db.setAppMeta(`folder_scan_ts:${data.folderId}`, String(data.scanMetaTs));
    }
    await db.updateScanProgress(job.id, {
      status: 'done',
      discovered: progress.discovered,
      processed: progress.processed,
      added: progress.added,
      currentFile: null,
      error: lastError ?? null,
    });
    log.info(`ingest-scan ${job.id} done: added ${progress.added} (${data.targetPath})`);

    // Index-on-import: ingest doesn't embed books, so when a scan actually added
    // items, kick the search backfill so newly imported ebooks become
    // searchable-inside without a manual reindex or worker restart. Idempotent
    // (only indexes books with no chunks) and deduped by the queue's singletonKey.
    if (progress.added > 0) {
      await enqueueBackfill({ lane: 'low' }).catch((err) =>
        log.warn(`post-scan backfill enqueue failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  } catch (err) {
    clearInterval(flush);
    const message = err instanceof Error ? err.message : String(err);
    await db.updateScanProgress(job.id, { status: 'failed', error: message }).catch(() => {});
    throw err; // surface to pg-boss for its retry policy
  }
}

/** Handle one search-backfill job: (re)index un-indexed ebooks. Idempotent. */
export async function handleSearchBackfill(db: LibraryDatabase, job: Job<SearchBackfillJob>): Promise<void> {
  await db.createScanJob({ id: job.id, kind: QUEUE.searchBackfill });
  await db.updateScanProgress(job.id, { status: 'active' });
  try {
    const r = await db.backfillBooks();
    await db.updateScanProgress(job.id, { status: 'done', added: r.indexed });
    log.info(`search-backfill ${job.id} done: indexed ${r.indexed} books, ${r.chunks} chunks`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.updateScanProgress(job.id, { status: 'failed', error: message }).catch(() => {});
    throw err;
  }
}

/**
 * Fill in page counts for EPUBs ingested before that was tracked. Bounded and
 * idempotent; runs in the worker so the web process does no backfills.
 */
export async function backfillEpubPageCounts(db: LibraryDatabase): Promise<void> {
  const { rows } = await db.pool.query<{ id: number; file_path: string }>(
    "SELECT id, file_path FROM comics WHERE media_type='book' AND LOWER(file_path) LIKE '%.epub' AND (page_count IS NULL OR page_count = 0)",
  );
  if (rows.length === 0) return;
  log.info(`Backfilling page counts for ${rows.length} EPUB(s)…`);
  let updated = 0;
  for (const row of rows) {
    try {
      const count = await withTimeout(getEpubSpineCount(row.file_path), 5000);
      if (count > 0) {
        await db.pool.query('UPDATE comics SET page_count = $1 WHERE id = $2', [count, row.id]);
        updated++;
      }
    } catch {
      /* individual failures are non-fatal */
    }
  }
  if (updated > 0) log.info(`EPUB page-count backfill complete: ${updated} updated.`);
}
