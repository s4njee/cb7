import { describe, expect, it } from 'vitest';
import { IngestQueue } from './ingestQueue';

describe('IngestQueue', () => {
  it('returns queued paths in first-in first-out order', async () => {
    const queue = new IngestQueue();

    queue.pushMany(['/comics/a.cbz', '/comics/b.cbz']);
    queue.complete();

    await expect(queue.shift()).resolves.toBe('/comics/a.cbz');
    await expect(queue.shift()).resolves.toBe('/comics/b.cbz');
    await expect(queue.shift()).resolves.toBeNull();
    expect(queue.totalSeen()).toBe(2);
  });

  it('waits for a future path when a worker shifts before discovery pushes', async () => {
    const queue = new IngestQueue();
    const pendingShift = queue.shift();

    queue.push('/books/book.pdf');

    await expect(pendingShift).resolves.toBe('/books/book.pdf');
    expect(queue.totalSeen()).toBe(1);
  });

  it('releases waiting workers with null when completed', async () => {
    const queue = new IngestQueue();
    const firstWorker = queue.shift();
    const secondWorker = queue.shift();

    queue.complete();

    await expect(firstWorker).resolves.toBeNull();
    await expect(secondWorker).resolves.toBeNull();
  });
});
