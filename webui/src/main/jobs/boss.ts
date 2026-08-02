/**
 * @module
 * pg-boss lifecycle — one durable job queue backed by the app's own Postgres.
 *
 * Both processes use this. The API starts it *producer-only* (just to enqueue);
 * the worker starts it fully (to also run jobs + maintenance + cron). Jobs live
 * in Postgres, so they survive process restarts — the whole point of the queue.
 *
 * pg-boss self-manages its own `pgboss` schema/migrations on start(); that is an
 * accepted, isolated exception to the idempotent-DDL convention in
 * `db/schema/createPg.ts`. CB8's own tables stay there.
 */
import { PgBoss } from 'pg-boss';
import { createLogger } from '../logger';
import { QUEUE } from './queues';

const log = createLogger('jobs');

let boss: PgBoss | null = null;

export interface StartBossOptions {
  /**
   * Producer-only mode (the API): don't run pg-boss maintenance, the
   * supervisor, or cron in this process. The worker owns those.
   */
  producerOnly?: boolean;
}

/** Start (once) and return the shared pg-boss instance. */
export async function startBoss(connectionString: string, opts: StartBossOptions = {}): Promise<PgBoss> {
  if (boss) return boss;
  const b = new PgBoss(
    opts.producerOnly
      ? { connectionString, supervise: false, schedule: false }
      : { connectionString },
  );
  b.on('error', (err: unknown) => log.error('pg-boss error:', err));
  await b.start();
  await ensureQueues(b);
  boss = b;
  log.info(`pg-boss started (${opts.producerOnly ? 'producer-only' : 'worker'})`);
  return b;
}

/** The started pg-boss instance. Throws if {@link startBoss} hasn't run. */
export function getBoss(): PgBoss {
  if (!boss) throw new Error('pg-boss not started — call startBoss() first');
  return boss;
}

/** Gracefully stop the queue (waits for in-flight jobs, then closes the pool). */
export async function stopBoss(): Promise<void> {
  if (!boss) return;
  const b = boss;
  boss = null;
  try {
    await b.stop({ graceful: true });
  } catch (err) {
    log.warn('pg-boss stop error:', err);
  }
}

/**
 * Create every known queue with its policy + retry/expiry defaults if it doesn't
 * already exist. The `exclusive` policy + a per-job `singletonKey` (set in
 * `producer.ts`) means only one job per key can be queued-or-active — that's our
 * dedupe (don't run two scans of the same path, or two backfills, at once).
 *
 * pg-boss caps `expireInSeconds` at 24h, so leases stay just under that.
 */
async function ensureQueues(b: PgBoss): Promise<void> {
  const defs: Array<[string, Parameters<PgBoss['createQueue']>[1]]> = [
    // A library scan can run for many minutes; give the lease plenty of headroom
    // so a healthy long job is never re-delivered mid-run. If the worker truly
    // dies, re-delivery after the lease is safe — handlers are idempotent.
    [QUEUE.ingestScan, { policy: 'exclusive', retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 2 * 60 * 60 }],
    [QUEUE.searchBackfill, { policy: 'exclusive', retryLimit: 1, expireInSeconds: 23 * 60 * 60 }],
    // FUTURE: OCR jobs are long and checkpoint per page; a generous lease lets a
    // healthy job run while still detecting a dead worker within a few hours.
    [QUEUE.ocrIndex, { policy: 'exclusive', retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 6 * 60 * 60 }],
  ];
  for (const [name, options] of defs) {
    if (await b.getQueue(name)) continue; // already created
    try {
      await b.createQueue(name, options);
    } catch (err) {
      // The API (producer) and worker can start together and race to create a
      // queue on a fresh DB. Tolerate that — but only if the queue now exists;
      // otherwise it's a real config error, so rethrow.
      if (!(await b.getQueue(name))) throw err;
    }
  }
}
