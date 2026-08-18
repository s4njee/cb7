import * as ArchiveLoader from '../archiveLoader';
import type { ArchiveHandle } from '../archiveLoader';

/**
 * @module
 * Shared Cache of Open Comic Archive Handles
 *
 * Architecture overview for Junior Devs:
 * When a reader flips through a comic, the server gets many requests for pages of
 * the *same* archive in quick succession. Opening the archive every time would be
 * wasteful, so this module keeps a small LRU cache of open archive handles keyed
 * by comic id, and hands them to callers through `withArchive(...)`.
 *
 * Two details make it safe under concurrency:
 *  - Reference counting: an entry isn't actually closed while a request is still
 *    reading from it; the close is deferred until the last reader is done.
 *  - TTL eviction: idle handles are closed after a timeout so file descriptors
 *    don't leak.
 */

const CACHE_CAPACITY = 5;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  handle: Promise<ArchiveHandle>;
  filePath: string;
  lastUsed: number;
  /** Number of callers currently holding this entry for a read. */
  refcount: number;
  /** True once evicted from the map; close is deferred until refcount hits 0. */
  evicted: boolean;
}

const handleCache = new Map<number, CacheEntry>();

/**
 * Mark an entry as evicted, but only call ArchiveLoader.close when no readers
 * are still using it. withArchive guarantees the refcount is held for the
 * full duration of any page read.
 */
function scheduleClose(entry: CacheEntry): void {
  if (entry.refcount > 0) return;
  entry.handle.then((h) => ArchiveLoader.close(h)).catch(() => {});
}

function evict(id: number, entry: CacheEntry): void {
  if (entry.evicted) return;
  entry.evicted = true;
  handleCache.delete(id);
  scheduleClose(entry);
}

/**
 * The cache stores the open *promise* (not the resolved handle) so that two
 * concurrent requests for the same uncached comic share a single open() call.
 * Storing the resolved handle would let both callers invoke ArchiveLoader.open
 * in parallel; one handle would end up in the map, the other would leak.
 */
async function acquireEntry(comicId: number, filePath: string): Promise<CacheEntry> {
  const now = Date.now();

  // Evict expired entries (close is deferred until readers drop).
  for (const [id, entry] of handleCache) {
    if (now - entry.lastUsed > CACHE_TTL_MS) evict(id, entry);
  }

  // Evict oldest entry if at capacity and we're about to add a new one.
  if (!handleCache.has(comicId) && handleCache.size >= CACHE_CAPACITY) {
    let oldestId = -1;
    let oldestTime = Infinity;
    for (const [id, entry] of handleCache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestId = id;
      }
    }
    if (oldestId !== -1) {
      const victim = handleCache.get(oldestId)!;
      evict(oldestId, victim);
    }
  }

  const existing = handleCache.get(comicId);
  if (existing) {
    existing.lastUsed = now;
    existing.refcount++;
    return existing;
  }

  const entry: CacheEntry = {
    handle: ArchiveLoader.open(filePath),
    filePath,
    lastUsed: now,
    refcount: 1,
    evicted: false,
  };
  handleCache.set(comicId, entry);
  entry.handle.catch(() => {
    // If the open failed, drop the entry so the next caller retries.
    if (handleCache.get(comicId) === entry) handleCache.delete(comicId);
    entry.evicted = true;
  });
  return entry;
}

function releaseEntry(entry: CacheEntry): void {
  entry.refcount = Math.max(0, entry.refcount - 1);
  if (entry.evicted) scheduleClose(entry);
}

/**
 * Borrow a handle for the duration of `fn`. The entry cannot be closed while
 * `fn` is running, even if TTL/capacity eviction marks it for removal.
 */
export async function withArchive<T>(
  comicId: number,
  filePath: string,
  fn: (handle: ArchiveHandle) => Promise<T>,
): Promise<T> {
  const entry = await acquireEntry(comicId, filePath);
  try {
    const handle = await entry.handle;
    return await fn(handle);
  } finally {
    releaseEntry(entry);
  }
}

export async function evictFromCache(comicId: number): Promise<void> {
  const entry = handleCache.get(comicId);
  if (!entry) return;
  evict(comicId, entry);
  // If there are no active readers, scheduleClose already kicked off. Wait
  // for the close to settle so callers (e.g., DELETE /api/comics/:id) can
  // then remove the file cleanly on Windows.
  if (entry.refcount === 0) {
    await entry.handle.then((h) => ArchiveLoader.close(h)).catch(() => {});
  }
}

export async function closeAllHandles(): Promise<void> {
  const entries = Array.from(handleCache.entries());
  for (const [id, entry] of entries) evict(id, entry);
  for (const [, entry] of entries) {
    if (entry.refcount === 0) {
      await entry.handle.then((h) => ArchiveLoader.close(h)).catch(() => {});
    }
  }
}
