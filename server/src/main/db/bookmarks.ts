import type { Db } from './pg';
import type { BookmarkResponse } from '../../shared/apiTypes';

/**
 * @module
 * Database Operations for Per-User Bookmarks
 *
 * Architecture overview for Junior Devs:
 * Owns the `bookmarks` table — a user saving a specific spot (with an optional
 * note) in a comic or book. A bookmark is anchored by exactly one of two things:
 * a `page` index for fixed-layout media (comics/PDFs), or a `location` EPUB CFI
 * for reflowable books, which have no stable page index. The unused column is
 * NULL, which the `BookmarkAnchor` union enforces at compile time and the route
 * layer enforces at the wire. Straightforward create/list/delete, scoped per
 * user. Free functions taking the async DB handle, surfaced through
 * `libraryDatabase.ts`.
 */

/** Exactly one anchor: a page index (comics/PDFs) or an EPUB CFI (reflowable). */
export type BookmarkAnchor =
  | { page: number; location?: undefined }
  | { location: string; page?: undefined };

interface BookmarkRow {
  id: number;
  page: number | null;
  location: string | null;
  note: string | null;
  created_at: string;
}

export async function createBookmark(
  db: Db,
  userId: number,
  comicId: number,
  anchor: BookmarkAnchor,
  note: string | null = null,
): Promise<BookmarkResponse & { userId: number; comicId: number }> {
  const row = (await db.get<BookmarkRow & { user_id: number; comic_id: number }>(
    'INSERT INTO bookmarks (user_id, comic_id, page, location, note) VALUES (?, ?, ?, ?, ?) RETURNING id, user_id, comic_id, page, location, note, created_at',
    [userId, comicId, anchor.page ?? null, anchor.location ?? null, note],
  ))!;
  return {
    id: row.id,
    userId: row.user_id,
    comicId: row.comic_id,
    page: row.page,
    location: row.location,
    note: row.note,
    createdAt: row.created_at,
  };
}

export async function listBookmarks(
  db: Db,
  userId: number,
  comicId: number,
): Promise<BookmarkResponse[]> {
  // Page-anchored bookmarks first in reading order, then the CFI-anchored ones
  // (whose page is NULL) — the server can't order CFIs meaningfully without
  // parsing them, so they fall to the end. `id` breaks ties so the order is
  // total and stable across calls.
  const rows = await db.all<BookmarkRow>(
    'SELECT id, page, location, note, created_at FROM bookmarks WHERE user_id = ? AND comic_id = ? ORDER BY page ASC NULLS LAST, id ASC',
    [userId, comicId],
  );
  return rows.map((r) => ({
    id: r.id,
    page: r.page,
    location: r.location,
    note: r.note,
    createdAt: r.created_at,
  }));
}

export async function updateBookmark(db: Db, userId: number, bookmarkId: number, note: string | null): Promise<void> {
  await db.run('UPDATE bookmarks SET note = ? WHERE id = ? AND user_id = ?', [note, bookmarkId, userId]);
}

export async function deleteBookmark(db: Db, userId: number, bookmarkId: number): Promise<void> {
  await db.run('DELETE FROM bookmarks WHERE id = ? AND user_id = ?', [bookmarkId, userId]);
}
