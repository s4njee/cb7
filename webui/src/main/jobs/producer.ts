/**
 * @module
 * Enqueue helpers used by the API routes (and the worker's auto-rescan).
 *
 * Thin wrappers over pg-boss `send` that pin the queue, pick a priority lane,
 * and set a `singletonKey` so identical work is deduped (a second scan of the
 * same path while one is already queued/active returns `null`).
 */
import { getBoss } from './boss';
import { QUEUE, type IngestScanJob } from './queues';

/** Priority lanes. Higher runs first; single/on-demand work jumps the backfill. */
export const PRIORITY = { high: 100, normal: 0, low: -100 } as const;
export type Lane = keyof typeof PRIORITY;

/**
 * Enqueue a library scan. Resolves to the pg-boss job id, or `null` if a scan of
 * the same path is already queued/active (deduped by `singletonKey`).
 */
export function enqueueScan(job: IngestScanJob, opts: { lane?: Lane } = {}): Promise<string | null> {
  return getBoss().send(QUEUE.ingestScan, job, {
    priority: PRIORITY[opts.lane ?? 'normal'],
    singletonKey: job.targetPath,
  });
}

/**
 * Enqueue an ebook search backfill. Resolves to the job id, or `null` if one is
 * already queued/active.
 */
export function enqueueBackfill(opts: { lane?: Lane } = {}): Promise<string | null> {
  return getBoss().send(QUEUE.searchBackfill, {}, {
    priority: PRIORITY[opts.lane ?? 'low'],
    singletonKey: QUEUE.searchBackfill,
  });
}
