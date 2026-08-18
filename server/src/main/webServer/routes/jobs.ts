import { sendJson, sendError } from '../middleware';
import { requireAdmin, type RouteHandler } from '../context';

/**
 * @module
 * Background-job status endpoints.
 *
 * Heavy work (library scans, the ebook search backfill) runs in the separate
 * cb8-worker process; the web UI enqueues it via the ingest routes and then
 * polls here for progress. Reads the `scan_jobs` mirror table, plus the
 * per-file ingest failures recorded against the job (`ingest_errors.job_id`).
 *   GET /api/jobs       → in-flight (queued/active) jobs + worker heartbeat +
 *                         live queue depth (admin)
 *   GET /api/jobs/:id   → one job's progress + its per-file failures (admin)
 */

/** A worker that hasn't reported in for this long is treated as down. */
const WORKER_STALE_MS = 90 * 1000;

export const handle: RouteHandler = async (ctx) => {
  const { res, db, method, pathname } = ctx;

  if (method === 'GET' && pathname === '/api/jobs') {
    if (!requireAdmin(ctx)) return true;
    const [jobs, heartbeat, queue] = await Promise.all([
      db.listActiveScanJobs(),
      db.getWorkerHeartbeat(),
      db.getQueueStatus(),
    ]);
    const alive = heartbeat != null && Date.now() - Date.parse(heartbeat) < WORKER_STALE_MS;
    sendJson(res, 200, {
      jobs,
      worker: { alive, lastSeenAt: heartbeat },
      queue,
    });
    return true;
  }

  const idMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (method === 'GET' && idMatch) {
    if (!requireAdmin(ctx)) return true;
    const job = await db.getScanJob(idMatch[1]);
    if (!job) {
      sendError(res, 404, 'Job not found');
      return true;
    }
    // Per-file failures newest-first, so the scan UI can show exactly which
    // files this job dropped and why.
    const failures = await db.getIngestErrorsForJob(job.id);
    sendJson(res, 200, { ...job, failures });
    return true;
  }

  return false;
};
