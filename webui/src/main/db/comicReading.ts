import type { MediaRecord } from '../../shared/types';
import type { SqlParam, ComicRow } from './types';
import { COMIC_NO_BLOB_COLUMNS } from './types';
import { NOW_TEXT_SQL, type Db } from './pg';
import { comicVisibilityCondition } from './libraryAccess';
import { rowsToRecords } from './comicRowMappers';

export async function updateReadingProgress(db: Db, comicId: number, pageIndex: number): Promise<void> {
  // Auto-flip completed when we hit the final page (pages are 0-indexed, so
  // last page = page_count - 1). Never downgrades completed → 0.
  await db.run(
    `UPDATE comics
     SET last_page = ?,
         last_read = ${NOW_TEXT_SQL},
         completed = CASE
           WHEN page_count > 0 AND ? >= page_count - 1 THEN 1
           ELSE completed
         END
     WHERE id = ?`,
    [pageIndex, pageIndex, comicId],
  );
}

export async function updateReadingLocation(db: Db, comicId: number, location: string): Promise<void> {
  await db.run(`UPDATE comics SET last_location = ?, last_read = ${NOW_TEXT_SQL} WHERE id = ?`, [location, comicId]);
}

export async function updateReadingPercent(db: Db, comicId: number, percent: number): Promise<void> {
  await db.run(`UPDATE comics SET last_percent = ?, last_read = ${NOW_TEXT_SQL} WHERE id = ?`, [percent, comicId]);
}

/**
 * Shared body for the recently-read / continue-reading lists.
 */
async function readingList(
  db: Db,
  limit: number,
  mediaType: 'comic' | 'book' | undefined,
  onlyIncomplete: boolean,
  userId: number | null,
): Promise<MediaRecord[]> {
  const conditions = ['c.last_read IS NOT NULL'];
  const params: SqlParam[] = [];
  if (onlyIncomplete) conditions.push('c.completed = 0');
  if (mediaType) {
    conditions.push('c.media_type = ?');
    params.push(mediaType);
  }
  // Per-user library access (P1-1): shelves never surface restricted books.
  const visibility = comicVisibilityCondition(userId);
  conditions.push(visibility.sql);
  params.push(...visibility.params);
  const rows = await db.all<ComicRow>(
    `SELECT ${COMIC_NO_BLOB_COLUMNS} FROM comics c
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.last_read DESC LIMIT ?`,
    [...params, limit],
  );
  return rowsToRecords(db, rows);
}

export function getRecentlyRead(
  db: Db,
  limit: number = 10,
  mediaType?: 'comic' | 'book',
  userId?: number | null,
): Promise<MediaRecord[]> {
  return readingList(db, limit, mediaType, false, userId ?? null);
}

export function getContinueReading(
  db: Db,
  limit: number = 10,
  mediaType?: 'comic' | 'book',
  userId?: number | null,
): Promise<MediaRecord[]> {
  return readingList(db, limit, mediaType, true, userId ?? null);
}
