import { sendJson, sendError } from '../middleware';
import { requireAdmin, type RouteHandler } from '../context';

/**
 * @module
 * Background-job status endpoints.
 *
 * Heavy work (library scans, the ebook search backfill) runs in the separate
 * cb8-worker process; the web UI enqueues it via the ingest routes and then
 * polls here for progress. Reads the `scan_jobs` mirror table.
 *   GET /api/jobs       → in-flight (queued/active) jobs (admin)
 *   GET /api/jobs/:id   → one job's progress (admin)
 */
export const handle: RouteHandler = async (ctx) => {
  const { res, db, method, pathname } = ctx;

  if (method === 'GET' && pathname === '/api/jobs') {
    if (!requireAdmin(ctx)) return true;
    sendJson(res, 200, { jobs: await db.listActiveScanJobs() });
    return true;
  }

  const idMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (method === 'GET' && idMatch) {
    if (!requireAdmin(ctx)) return true;
    const job = await db.getScanJob(decodeURIComponent(idMatch[1]));
    if (!job) {
      sendError(res, 404, 'Job not found');
      return true;
    }
    sendJson(res, 200, job);
    return true;
  }

  return false;
};
