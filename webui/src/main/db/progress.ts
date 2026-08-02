import { NOW_TEXT_SQL, type Db } from './pg';
import type { SqlParam, ComicRow } from './types';
import { rowsToRecords } from './comics';
import type { MediaRecord } from '../../shared/types';

/**
 * @module
 * Database Operations for Per-User Reading Progress
 *
 * Architecture overview for Junior Devs:
 * Owns the `user_progress` table — one row per (user, comic) capturing the last
 * page/location, last-read time, and completed flag. This is what powers the
 * "continue reading" and "recently read" lists, scoped per user so each person
 * sees their own position. Free functions taking the async DB handle, surfaced
 * through `libraryDatabase.ts`.
 */

export async function upsertUserProgress(
  db: Db,
  userId: number,
  comicId: number,
  opts: { page?: number | null; location?: string | null; percent?: number | null; completed?: boolean },
): Promise<void> {
  // Atomic upsert. A previous SELECT-then-INSERT/UPDATE raced: two near-
  // simultaneous saves for the same user+comic (e.g. a position save and the
  // back-button flush) both saw "no row" and both INSERTed, and the second hit
  // the (user_id, comic_id) PK — a 500 the client swallowed, so progress silently
  // didn't save. ON CONFLICT keeps the "only touch provided fields" semantics
  // (absent fields stay untouched on update, take column defaults on insert).
  const cols: string[] = ['user_id', 'comic_id'];
  const vals: SqlParam[] = [userId, comicId];
  const sets: string[] = [];
  if (opts.page !== undefined) { cols.push('last_page'); vals.push(opts.page); sets.push('last_page = EXCLUDED.last_page'); }
  if (opts.location !== undefined) { cols.push('last_location'); vals.push(opts.location); sets.push('last_location = EXCLUDED.last_location'); }
  if (opts.percent !== undefined) { cols.push('last_percent'); vals.push(opts.percent); sets.push('last_percent = EXCLUDED.last_percent'); }
  if (opts.completed !== undefined) { cols.push('completed'); vals.push(opts.completed ? 1 : 0); sets.push('completed = EXCLUDED.completed'); }
  sets.push(`last_read = ${NOW_TEXT_SQL}`);
  const placeholders = vals.map(() => '?').join(', ');
  await db.run(
    `INSERT INTO user_progress (${cols.join(', ')}, last_read)
     VALUES (${placeholders}, ${NOW_TEXT_SQL})
     ON CONFLICT (user_id, comic_id) DO UPDATE SET ${sets.join(', ')}`,
    vals,
  );
}

export async function clearUserProgress(db: Db, userId: number, comicId: number): Promise<void> {
  await db.run('DELETE FROM user_progress WHERE user_id = ? AND comic_id = ?', [userId, comicId]);
}

export async function getUserProgress(
  db: Db,
  userId: number,
  comicId: number,
): Promise<{ lastPage: number | null; lastLocation: string | null; lastPercent: number | null; lastRead: string | null; completed: boolean } | null> {
  const row = await db.get<{ last_page: number | null; last_location: string | null; last_percent: number | null; last_read: string | null; completed: number }>(
    'SELECT last_page, last_location, last_percent, last_read, completed FROM user_progress WHERE user_id = ? AND comic_id = ?',
    [userId, comicId],
  );
  if (!row) return null;
  return { lastPage: row.last_page, lastLocation: row.last_location, lastPercent: row.last_percent, lastRead: row.last_read, completed: !!row.completed };
}

/**
 * Batched per-user progress lookup for list responses.
 *
 * The per-record `getUserProgress` turns a list endpoint into N queries;
 * this fetches the same rows for every comic id in one round trip. Returns a
 * map keyed by comic id — absent ids simply have no progress row.
 */
export async function getUserProgressForComics(
  db: Db,
  userId: number,
  comicIds: number[],
): Promise<Map<number, { lastPage: number | null; lastLocation: string | null; lastPercent: number | null; lastRead: string | null; completed: boolean }>> {
  const out = new Map<number, { lastPage: number | null; lastLocation: string | null; lastPercent: number | null; lastRead: string | null; completed: boolean }>();
  const ids = Array.from(new Set(comicIds));
  if (!ids.length) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all<{ comic_id: number; last_page: number | null; last_location: string | null; last_percent: number | null; last_read: string | null; completed: number }>(
    `SELECT comic_id, last_page, last_location, last_percent, last_read, completed
     FROM user_progress WHERE user_id = ? AND comic_id IN (${placeholders})`,
    [userId, ...ids],
  );
  for (const row of rows) {
    out.set(row.comic_id, {
      lastPage: row.last_page,
      lastLocation: row.last_location,
      lastPercent: row.last_percent,
      lastRead: row.last_read,
      completed: !!row.completed,
    });
  }
  return out;
}

export async function getRecentlyReadByUser(
  db: Db,
  userId: number,
  limit: number,
  mediaType?: 'comic' | 'book',
): Promise<MediaRecord[]> {
  const where = mediaType ? 'AND c.media_type = ?' : '';
  const params: SqlParam[] = [userId];
  if (mediaType) params.push(mediaType);
  params.push(limit);
  const rows = await db.all<ComicRow>(
    `SELECT c.id, c.file_path, c.title, c.page_count, c.file_size, NULL as cover_thumbnail, c.date_added,
            up.last_page, up.last_location, up.last_percent, up.last_read, c.media_type
     FROM user_progress up
     JOIN comics c ON up.comic_id = c.id
     WHERE up.user_id = ? ${where}
     ORDER BY up.last_read DESC
     LIMIT ?`,
    params,
  );
  return rowsToRecords(db, rows);
}

export async function getContinueReadingByUser(
  db: Db,
  userId: number,
  limit: number,
  mediaType?: 'comic' | 'book',
): Promise<MediaRecord[]> {
  const where = mediaType ? 'AND c.media_type = ?' : '';
  const params: SqlParam[] = [userId];
  if (mediaType) params.push(mediaType);
  params.push(limit);
  const rows = await db.all<ComicRow>(
    `SELECT c.id, c.file_path, c.title, c.page_count, c.file_size, NULL as cover_thumbnail, c.date_added,
            up.last_page, up.last_location, up.last_percent, up.last_read, c.media_type
     FROM user_progress up
     JOIN comics c ON up.comic_id = c.id
     WHERE up.user_id = ? AND up.completed = 0 ${where}
     ORDER BY up.last_read DESC
     LIMIT ?`,
    params,
  );
  return rowsToRecords(db, rows);
}
