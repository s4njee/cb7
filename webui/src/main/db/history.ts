import type { Db } from './pg';
import type { HistoryResponse } from '../../shared/apiTypes';
import type { CountRow } from './types';

/**
 * @module
 * Database Operations for Reading History
 *
 * Architecture overview for Junior Devs:
 * Owns the `reading_history` table — an append-only log of user actions (e.g.
 * opened, read a page) with a timestamp. Used for activity/recency features.
 * Free functions taking the async DB handle, surfaced through `libraryDatabase.ts`.
 */

export async function logHistory(db: Db, userId: number, comicId: number, action: string, page: number | null): Promise<void> {
  await db.run('INSERT INTO reading_history (user_id, comic_id, action, page) VALUES (?, ?, ?, ?)', [userId, comicId, action, page]);
}

export async function getHistory(
  db: Db,
  userId: number,
  offset: number,
  limit: number,
): Promise<HistoryResponse> {
  const countRow = await db.get<CountRow>('SELECT COUNT(*) as cnt FROM reading_history WHERE user_id = ?', [userId]);
  const totalCount = countRow?.cnt ?? 0;
  const rows = await db.all<{ id: number; comic_id: number; comic_title: string | null; action: string; page: number | null; timestamp: string }>(
    `SELECT h.id, h.comic_id, c.title as comic_title, h.action, h.page, h.timestamp
     FROM reading_history h
     LEFT JOIN comics c ON h.comic_id = c.id
     WHERE h.user_id = ?
     ORDER BY h.timestamp DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset],
  );
  return {
    entries: rows.map((r) => ({
      id: r.id, comicId: r.comic_id, comicTitle: r.comic_title ?? '(deleted)',
      action: r.action, page: r.page, timestamp: r.timestamp,
    })),
    totalCount,
  };
}
