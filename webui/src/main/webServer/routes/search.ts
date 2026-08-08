import { sendJson, sendError } from '../middleware';
import { requireAdmin, type RouteHandler } from '../context';
import { embed } from '../../search/embedClient';
import { rrfFuse } from '../../search/searchUtil';
import { enqueueBackfill } from '../../jobs/producer';
import { createLogger } from '../../logger';

const log = createLogger('search');

/**
 * @module
 * Search inside e-books. `GET /api/search?q=` runs hybrid keyword + semantic
 * retrieval (Postgres FTS + pgvector, fused with RRF) and returns ranked
 * passages with the book + a snippet. `POST /api/search/reindex` (admin)
 * enqueues a full background backfill (wipe the index, then re-embed every
 * book) and returns the pg-boss job id — the worker runs the rebuild.
 */
export const handle: RouteHandler = async (ctx) => {
  const { res, db, method, pathname, query } = ctx;

  if (method === 'GET' && pathname === '/api/search') {
    const q = (typeof query.q === 'string' ? query.q : '').trim();
    if (!q) {
      sendError(res, 400, 'Provide a ?q= query');
      return true;
    }
    let queryVec: number[] | undefined;
    try {
      [queryVec] = await embed([q]);
    } catch (err) {
      log.warn(`Embedding service unavailable; running keyword-only search: ${err instanceof Error ? err.message : String(err)}`);
    }
    const N = 20;
    const [kw, sem] = await Promise.all([
      db.ftsCandidates(q, N),
      queryVec ? db.vectorCandidates(queryVec, N) : Promise.resolve([]),
    ]);
    const kwIds = new Set(kw.map((r) => r.id));
    const semIds = new Set(sem.map((r) => r.id));
    const top = rrfFuse([kw, sem], 60, 8);
    sendJson(res, 200, {
      query: q,
      results: top.map((r) => ({
        comicId: r.comic_id,
        book: r.title,
        chapter: r.chapter,
        snippet: r.content.replace(/\s+/g, ' ').slice(0, 240),
        via: kwIds.has(r.id) && semIds.has(r.id) ? 'both' : kwIds.has(r.id) ? 'keyword' : 'semantic',
      })),
    });
    return true;
  }

  // Full rebuild: enqueue a search-backfill job that wipes the ebook index in
  // the worker, then re-embeds every book — the request returns immediately
  // instead of blocking for minutes. The full (non-deduped-against-incremental)
  // singletonKey guarantees a wipe+rebuild isn't lost behind an already-queued
  // incremental backfill. Poll GET /api/jobs/:jobId for progress.
  if (method === 'POST' && pathname === '/api/search/reindex') {
    if (!requireAdmin(ctx)) return true;
    const jobId = await enqueueBackfill({ lane: 'normal', full: true });
    sendJson(res, 200, { jobId: jobId ?? null, status: 'queued' });
    return true;
  }

  return false;
};
