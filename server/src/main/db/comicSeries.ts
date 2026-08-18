import type { MediaRecord } from '../../shared/types';
import type { SqlParam, ComicRow } from './types';
import { COMIC_NO_BLOB_COLUMNS } from './types';
import type { Db } from './pg';
import { comicVisibilityCondition } from './libraryAccess';
import { rowsToRecords } from './comicRowMappers';

export async function setComicSeries(
  db: Db,
  comicId: number,
  seriesName: string | null,
  volumeNumber: number | null,
  chapterNumber: number | null,
): Promise<void> {
  await db.run('UPDATE comics SET series_name = ?, volume_number = ?, chapter_number = ? WHERE id = ?', [seriesName, volumeNumber, chapterNumber, comicId]);
}

export async function getAllSeries(
  db: Db,
  userId?: number | null,
  admin?: boolean,
): Promise<{ name: string; count: number; coverComicId: number | null }[]> {
  const conditions = ["series_name IS NOT NULL AND series_name != ''"];
  const params: SqlParam[] = [];
  // Per-user library access (P1-1): a series only appears when the user can see
  // at least one of its comics.
  if (admin !== true) {
    const visibility = comicVisibilityCondition(userId ?? null);
    conditions.push(visibility.sql);
    params.push(...visibility.params);
  }
  // Cover id is picked from a visible volume only — otherwise the grid would
  // request (and, before the content-route gate, serve) a restricted book's cover.
  const coverVisibility = admin === true ? null : comicVisibilityCondition(userId ?? null, 'c2');
  const coverWhere = coverVisibility
    ? ` AND ${coverVisibility.sql}`
    : '';
  const coverParams = coverVisibility?.params ?? [];
  const rows = await db.all<{ name: string; count: number; cover_id: number | null }>(
    `SELECT series_name as name, COUNT(*) as count,
      (SELECT c2.id FROM comics c2 WHERE c2.series_name = c.series_name${coverWhere} ORDER BY COALESCE(c2.volume_number, 999999), COALESCE(c2.chapter_number, 999999), c2.id LIMIT 1) as cover_id
     FROM comics c
     WHERE ${conditions.join(' AND ')}
     GROUP BY series_name
     ORDER BY lower(series_name)`,
    [...coverParams, ...params],
  );
  return rows.map((r) => ({ name: r.name, count: r.count, coverComicId: r.cover_id }));
}

export async function getSeriesComics(
  db: Db,
  name: string,
  userId?: number | null,
  admin?: boolean,
): Promise<MediaRecord[]> {
  const conditions = ['lower(c.series_name) = lower(?)'];
  const params: SqlParam[] = [name];
  if (admin !== true) {
    const visibility = comicVisibilityCondition(userId ?? null);
    conditions.push(visibility.sql);
    params.push(...visibility.params);
  }
  const rows = await db.all<ComicRow>(
    `SELECT ${COMIC_NO_BLOB_COLUMNS}
     FROM comics c
     WHERE ${conditions.join(' AND ')}
     ORDER BY COALESCE(c.volume_number, 999999), COALESCE(c.chapter_number, 999999), lower(c.title)`,
    params,
  );
  return rowsToRecords(db, rows);
}
