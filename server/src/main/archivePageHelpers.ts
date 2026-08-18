/**
 * @module
 * Cached Page Reads for Comic Archives
 *
 * Architecture overview for Junior Devs:
 * Reading a single page out of a comic archive (.cbz/.cbr) is relatively
 * expensive, and the reader often re-requests the same pages (flipping back and
 * forth). This module wraps an LRU cache, keyed by page index and bounded by
 * total bytes, so recently-read pages are served from memory instead of being
 * re-extracted.
 *
 * The pieces: `createArchivePageCache` builds the byte-bounded cache,
 * `assertArchivePageInRange` validates an index before any work, and
 * `getCachedArchivePage` ties them together — it bounds-checks, returns a cached
 * page when present, otherwise calls the supplied `loadPage` extractor, caches
 * the result, and normalises any read failure into a clear error.
 */
import { LruByBytes } from '../shared/lru';

/** An LRU cache of decoded archive pages, keyed by page index, bounded by bytes. */
export type ArchivePageCache = LruByBytes<number, Buffer>;

/**
 * Create a byte-bounded LRU cache for archive pages.
 * @param maxBytes The maximum total size of cached page buffers.
 * @returns A new page cache that evicts least-recently-used pages by size.
 */
export function createArchivePageCache(maxBytes: number): ArchivePageCache {
  return new LruByBytes<number, Buffer>({
    maxBytes,
    sizeOf: (buffer) => buffer.length,
  });
}

/**
 * Throw if a page index is outside the archive's range.
 * @param pageIndex The 0-based page index to validate.
 * @param pageCount The archive's total page count.
 * @throws Error when the index is negative or >= pageCount.
 */
export function assertArchivePageInRange(pageIndex: number, pageCount: number): void {
  if (pageIndex < 0 || pageIndex >= pageCount) {
    throw new Error(`Page index ${pageIndex} out of range (0-${pageCount - 1})`);
  }
}

/**
 * Get a page buffer from cache, loading and caching it on a miss.
 * Validates the index first, returns the cached buffer when present,
 *          otherwise awaits `loadPage`, caches the result, and re-throws any
 *          load failure wrapped with the page number for context.
 * @param cache The archive page cache to read/populate.
 * @param pageIndex The 0-based page index to fetch.
 * @param pageCount The archive's total page count (for range checking).
 * @param loadPage Extractor invoked on a cache miss to read the page.
 * @returns The page's buffer.
 */
export async function getCachedArchivePage(
  cache: ArchivePageCache,
  pageIndex: number,
  pageCount: number,
  loadPage: () => Promise<Buffer>,
): Promise<Buffer> {
  assertArchivePageInRange(pageIndex, pageCount);

  const cached = cache.get(pageIndex);
  if (cached) return cached;

  try {
    const buffer = await loadPage();
    cache.set(pageIndex, buffer);
    return buffer;
  } catch (err) {
    throw new Error(
      `Failed to read page ${pageIndex}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
