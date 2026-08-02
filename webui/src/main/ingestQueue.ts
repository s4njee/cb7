/**
 * @module
 * Async Producer/Consumer Queue for the Ingest Pipeline
 *
 * Architecture overview for Junior Devs:
 * When the library scans a folder, one side discovers file paths (the producer)
 * while several worker tasks process them concurrently (the consumers). Their
 * speeds don't match, so they need a buffer between them — that's this queue.
 *
 * The clever bit is `shift()`: if a file is waiting it returns immediately, but
 * if the queue is momentarily empty it hands back a Promise that resolves as
 * soon as the producer pushes the next path — so workers sleep instead of
 * busy-looping. When discovery finishes, `complete()` wakes every waiting worker
 * with `null`, the agreed "no more work" signal. Keeping this primitive separate
 * from `ingestService` keeps the worker flow there easy to read.
 */

/** A back-pressure-free queue of file paths bridging discovery and workers. */
export class IngestQueue {
  private items: string[] = [];
  private waiters: ((path: string | null) => void)[] = [];
  private done = false;
  private seen = 0;

  /**
   * Enqueue many paths at once.
   * @param paths The file paths to enqueue.
   */
  pushMany(paths: string[]): void {
    for (const path of paths) this.push(path);
  }

  /**
   * Enqueue one path, handing it directly to a waiting worker if any.
   * @param path The file path to enqueue.
   */
  push(path: string): void {
    this.seen++;
    const waiter = this.waiters.shift();
    if (waiter) waiter(path);
    else this.items.push(path);
  }

  /**
   * Signal that no more paths will be produced.
   * Resolves every currently-waiting `shift()` with `null` so workers
   *          can exit cleanly.
   */
  complete(): void {
    this.done = true;
    for (const waiter of this.waiters) waiter(null);
    this.waiters.length = 0;
  }

  /**
   * Total number of paths ever pushed.
   * @returns The running count (used for progress reporting).
   */
  totalSeen(): number {
    return this.seen;
  }

  /**
   * Take the next path, waiting if the queue is temporarily empty.
   * Resolves immediately with a buffered path; otherwise with `null`
   *          if already completed, or with a pending Promise that resolves on the
   *          next `push()`/`complete()`.
   * @returns The next path, or `null` when the queue is drained and complete.
   */
  shift(): Promise<string | null> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    if (this.done) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
