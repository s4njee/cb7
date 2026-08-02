import { sendJson, sendError } from '../middleware';
import { requireAdmin, type RouteHandler } from '../context';
import { embed } from '../../search/embedClient';
import { rrfFuse } from '../../search/searchUtil';

/**
 * @module
 * Search inside e-books. `GET /api/search?q=` runs hybrid keyword + semantic
 * retrieval (Postgres FTS + pgvector, fused with RRF) and returns ranked
 * passages with the book + a snippet. `POST /api/search/reindex` (admin)
 * rebuilds the index for all books.
 */
export const handle: RouteHandler = async (ctx) => {
  const { res, db, method, pathname, query } = ctx;

  if (method === 'GET' && pathname === '/api/search') {
    const q = (typeof query.q === 'string' ? query.q : '').trim();
    if (!q) {
      sendError(res, 400, 'Provide a ?q= query');
      return true;
    }
    let queryVec: number[];
    try {
      [queryVec] = await embed([q]);
    } catch {
      sendError(res, 503, 'Embedding service unavailable');
      return true;
    }
    const N = 20;
    const [kw, sem] = await Promise.all([db.ftsCandidates(q, N), db.vectorCandidates(queryVec, N)]);
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

  // Force rebuild: wipe the whole ebook index, then re-embed every book. Clears
  // partial/stale indexes (e.g. left by an earlier embed failure) that the
  // incremental backfill would otherwise skip.
  if (method === 'POST' && pathname === '/api/search/reindex') {
    if (!requireAdmin(ctx)) return true;
    await db.clearEbookIndex();
    sendJson(res, 200, await db.backfillBooks());
    return true;
  }

  return false;
};
