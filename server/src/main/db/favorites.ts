import type { Db } from './pg';

/**
 * @module
 * Database Operations for Per-User Favorites
 *
 * Architecture overview for Junior Devs:
 * Owns the `user_favorites` table — a simple per-(user, comic) "starred" flag.
 * Adding uses `ON CONFLICT DO NOTHING` so favoriting twice is harmless. Free
 * functions taking the async DB handle, surfaced through `libraryDatabase.ts`.
 */

export async function addFavorite(db: Db, userId: number, comicId: number): Promise<void> {
  await db.run('INSERT INTO user_favorites (user_id, comic_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [userId, comicId]);
}

export async function removeFavorite(db: Db, userId: number, comicId: number): Promise<void> {
  await db.run('DELETE FROM user_favorites WHERE user_id = ? AND comic_id = ?', [userId, comicId]);
}

export async function isFavorite(db: Db, userId: number, comicId: number): Promise<boolean> {
  const row = await db.get('SELECT 1 FROM user_favorites WHERE user_id = ? AND comic_id = ?', [userId, comicId]);
  return row !== undefined;
}

/**
 * Batched favorite lookup for list responses — one query for all comic ids
 * instead of a per-record `isFavorite` round trip.
 * @returns The subset of `comicIds` this user has favorited.
 */
export async function getFavoritedComicIds(db: Db, userId: number, comicIds: number[]): Promise<Set<number>> {
  const ids = Array.from(new Set(comicIds));
  if (!ids.length) return new Set();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all<{ comic_id: number }>(
    `SELECT comic_id FROM user_favorites WHERE user_id = ? AND comic_id IN (${placeholders})`,
    [userId, ...ids],
  );
  return new Set(rows.map((r) => r.comic_id));
}
