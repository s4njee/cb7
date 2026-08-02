/**
 * @module
 * Background Worker Entry Point (Docker / k8s `cb8-worker`)
 *
 * The CB8 web server (`standalone.ts`) now only *enqueues* heavy work; this
 * separate process *drains* it. It connects to the same Postgres, starts pg-boss
 * as a full worker (maintenance + cron), and registers idempotent handlers:
 *
 *   - ingest-scan      → walk a path and ingest comics/books (manual + rescan)
 *   - search-backfill  → (re)build the ebook semantic-search index
 *
 * Plus the auto-rescan scheduler, which enqueues a durable ingest-scan job per
 * folder on an interval. Because every job lives in Postgres, a restart resumes
 * in-flight work; handlers are idempotent so re-delivery never duplicates rows.
 *
 * Runs the same image as the API, just with `node dist/worker.mjs` instead of
 * `node dist/standalone.mjs`. No Fastify, no HTTP listener.
 */
import * as path from 'node:path';
import type { Job } from 'pg-boss';
import { LibraryDatabase } from './libraryDatabase';
import { setImageCacheRoot } from './imageResizer';
import { createLogger } from './logger';
import { FolderScheduler } from './folderScheduler';
import { startBoss, stopBoss } from './jobs/boss';
import { enqueueScan, enqueueBackfill } from './jobs/producer';
import { QUEUE, type IngestScanJob, type SearchBackfillJob } from './jobs/queues';
import { handleIngestScan, handleSearchBackfill, backfillEpubPageCounts } from './jobs/handlers';

const log = createLogger('worker');

async function main(): Promise<void> {
  const dataDir = process.env.CB8_DATA_DIR ?? '/var/lib/cb8';
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (a Postgres connection string).');
  }

  setImageCacheRoot(path.join(dataDir, 'image-cache'));

  log.info('Worker startup: connecting to Postgres');
  const db = new LibraryDatabase(databaseUrl);
  await db.initialize();
  log.info('Worker startup: database ready');

  const boss = await startBoss(databaseUrl);

  // batchSize 1 + default concurrency → one heavy job at a time per queue. Each
  // scan already parallelizes internally (CB8_INGEST_CONCURRENCY).
  await boss.work<IngestScanJob>(QUEUE.ingestScan, { batchSize: 1 }, async (incoming: Job<IngestScanJob>[]) => {
    for (const job of incoming) await handleIngestScan(db, job);
  });
  await boss.work<SearchBackfillJob>(QUEUE.searchBackfill, { batchSize: 1 }, async (incoming: Job<SearchBackfillJob>[]) => {
    for (const job of incoming) await handleSearchBackfill(db, job);
  });

  // Auto-rescan: enqueue a durable low-priority scan job per due folder.
  const scheduler = new FolderScheduler(db, async (req) => {
    await enqueueScan(
      { targetPath: req.commonDir, folderId: req.folderId, since: req.since, scanMetaTs: req.scanStartMs },
      { lane: 'low' },
    );
  });
  scheduler.start();

  // Backfills that used to run in the API process now live here.
  void backfillEpubPageCounts(db).catch((err) => log.warn('EPUB page-count backfill error:', err));
  if (process.env.SEARCH_BACKFILL_ON_START === '1') {
    log.info('Search backfill: enqueueing on start');
    void enqueueBackfill().catch((err) => log.warn('search backfill enqueue failed:', err));
  }

  log.info('Worker ready — draining queues');

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Worker shutting down…');
    scheduler.stop();
    try { await stopBoss(); } catch { /* ignore */ }
    try { await db.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

main().catch((err) => {
  log.error('Worker startup failed:', err);
  process.exit(1);
});
