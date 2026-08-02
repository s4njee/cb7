import * as path from 'node:path';
import type { LibraryDatabase } from '../libraryDatabase';

/**
 * @module
 * Translate Internal Records Into Safe API Shapes
 *
 * Architecture overview for Junior Devs:
 * The internal `MediaRecord` contains things we must NOT send to a browser —
 * most importantly the absolute server file path. `toWebRecord` converts an
 * internal record into the safe `WebComicRecord` the API returns.
 * `overlayUserState` then layers the current user's progress and favorite flag
 * on top. Think of this file as the boundary that decides what leaves the server.
 */

/** Safe comic record for the API — never exposes the server file path. */
export interface WebComicRecord {
  id: number;
  title: string;
  pageCount: number;
  fileSize: number;
  dateAdded: string;
  tags: string[];
  lastPage: number | null;
  lastLocation: string | null;
  /** Whole-book reading position 0-100 for reflowable formats (EPUB); null otherwise. */
  lastPercent: number | null;
  lastRead: string | null;
  mediaType: 'comic' | 'book';
  thumbnailUrl: string;
  /** File extension without the dot: 'epub' | 'pdf' | 'mobi' | 'cbz' | 'cbr' */
  fileExt: string;
}

/**
 * Convert an internal comic record into the safe API shape.
 * Drops the server file path and adds derived fields (thumbnail URL,
 * file extension).
 * @param record The internal record, or null/undefined.
 * @returns A `WebComicRecord`, or `null` when given no record.
 */
export function toWebRecord(record: Awaited<ReturnType<LibraryDatabase['getComic']>>): WebComicRecord | null {
  if (!record) return null;
  // Version the thumbnail URL with a stable per-row value so the browser
  // evicts its cache whenever the underlying record changes. Without this,
  // wiping + re-scanning reuses the same /api/comics/1/thumbnail URL and the
  // browser serves the previous comic's blob from its 1h cache.
  const v = Date.parse(record.dateAdded);
  const vParam = Number.isFinite(v) ? String(v) : encodeURIComponent(record.dateAdded);
  return {
    id: record.id,
    title: record.title,
    pageCount: record.pageCount,
    fileSize: record.fileSize,
    dateAdded: record.dateAdded,
    tags: record.tags,
    lastPage: record.lastPage,
    lastLocation: record.lastLocation ?? null,
    lastPercent: record.lastPercent ?? null,
    lastRead: record.lastRead,
    mediaType: record.mediaType,
    thumbnailUrl: `/api/comics/${record.id}/thumbnail?v=${vParam}`,
    fileExt: path.extname(record.filePath).toLowerCase().replace(/^\./, ''),
  };
}

/**
 * Layer the current user's progress and favorite flag onto a web record.
 *
 * For guests (`userId == null`) the progress fields are blanked out —
 * otherwise the shared base row would leak the admin's reading position to
 * everyone.
 *
 * @param base The user-agnostic web record from `toWebRecord`.
 * @param db The library database to read per-user state from.
 * @param userId The current user's id, or `null` for a guest.
 * @returns A copy of `base` with this user's progress and a `favorited` flag.
 */
export async function overlayUserState(
  base: WebComicRecord,
  db: LibraryDatabase,
  userId: number | null,
): Promise<WebComicRecord & { favorited: boolean }> {
  // Guests resume from the shared position stored on the comic itself — `base`
  // already carries last_page / last_location / last_percent.
  if (userId == null) {
    return { ...base, favorited: false };
  }
  const up = await db.getUserProgress(userId, base.id);
  const favorited = await db.isFavorite(userId, base.id);
  // A logged-in user's own progress always takes priority. If they've never
  // opened this book, fall back to the shared position (kept on `base`) so they
  // still resume where the last reader left off.
  if (up) {
    return {
      ...base,
      lastPage: up.lastPage,
      lastLocation: up.lastLocation,
      lastPercent: up.lastPercent,
      lastRead: up.lastRead,
      favorited,
    };
  }
  return { ...base, favorited };
}

/**
 * Batched `overlayUserState` for list endpoints.
 *
 * Overlaying records one at a time costs two queries per record (progress +
 * favorite) — an N+1 that grows with the list. This fetches the user's
 * progress and favorites for every id in two total queries, then applies the
 * same priority rules as `overlayUserState`.
 *
 * @param bases The user-agnostic web records from `toWebRecord`.
 * @param db The library database to read per-user state from.
 * @param userId The current user's id, or `null` for a guest.
 * @returns Copies of `bases` with this user's progress and `favorited` flags.
 */
export async function overlayUserStateMany(
  bases: WebComicRecord[],
  db: LibraryDatabase,
  userId: number | null,
): Promise<(WebComicRecord & { favorited: boolean })[]> {
  // Guests resume from the shared position already carried on each base.
  if (userId == null || bases.length === 0) {
    return bases.map((base) => ({ ...base, favorited: false }));
  }
  const ids = bases.map((base) => base.id);
  const [progressById, favoritedIds] = await Promise.all([
    db.getUserProgressForComics(userId, ids),
    db.getFavoritedComicIds(userId, ids),
  ]);
  return bases.map((base) => {
    const up = progressById.get(base.id);
    const favorited = favoritedIds.has(base.id);
    if (up) {
      return {
        ...base,
        lastPage: up.lastPage,
        lastLocation: up.lastLocation,
        lastPercent: up.lastPercent,
        lastRead: up.lastRead,
        favorited,
      };
    }
    return { ...base, favorited };
  });
}
