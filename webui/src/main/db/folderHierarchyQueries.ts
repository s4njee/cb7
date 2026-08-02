import type { MediaRecord } from '../../shared/types';
import type { ComicListRow, CountRow } from './types';
import { COMIC_LIST_COLUMNS, userOverlaySelect } from './types';
import { rowToListRecord } from './comics';
import { resolvePaging } from './comicQueryHelpers';
import type { Db } from './pg';
import { buildHierarchyScope, type FolderHierarchyOptions } from './folderHierarchyScope';
import {
  FOLDER_GROUP_NONE_KEY,
  addNumberFilter,
  addSeriesFilter,
  formatNumberLabel,
  numericGroupKey,
} from './folderHierarchyHelpers';

/**
 * @module
 * Folder and Global Hierarchy Query Cores
 *
 * Architecture overview for Junior Devs:
 * The app exposes the same series -> volume -> chapter tree in two places:
 * inside a specific folder, and across the whole library browse view. These
 * functions are the shared SQL cores for both modes. A `folderId` of `null`
 * means "global browse"; a numeric folder id narrows the same query shape to
 * one folder. `folders.ts` keeps the public wrapper names.
 */

export interface FolderSeriesGroup {
  key: string;
  name: string;
  count: number;
  coverComicId: number | null;
}

export interface FolderVolumeGroup {
  key: string;
  label: string;
  volumeNumber: number | null;
  count: number;
  chapterCount: number;
  coverComicId: number | null;
  singleComicId: number | null;
}

export interface FolderChapterGroup {
  key: string;
  label: string;
  chapterNumber: number | null;
  count: number;
  coverComicId: number | null;
  singleComicId: number | null;
}

type UserComicListRow = ComicListRow & {
  up_last_page: number | null;
  up_last_location: string | null;
  up_last_percent: number | null;
  up_last_read: string | null;
  is_fav: number;
};

export type FolderVolumeComicsResult = {
  records: (MediaRecord & { favorited?: boolean })[];
  totalCount: number;
};

function applyUserState(
  row: UserComicListRow,
  base: MediaRecord,
  userId: number | null,
): MediaRecord & { favorited?: boolean } {
  return {
    ...base,
    lastPage: userId != null ? row.up_last_page : base.lastPage,
    lastLocation: userId != null ? row.up_last_location : base.lastLocation,
    lastPercent: userId != null ? row.up_last_percent : base.lastPercent,
    lastRead: userId != null ? row.up_last_read : base.lastRead,
    favorited: Boolean(row.is_fav),
  };
}

export async function getScopedSeriesGroups(
  db: Db,
  userId: number | null,
  folderId: number | null,
  options: FolderHierarchyOptions,
): Promise<FolderSeriesGroup[]> {
  const scope = buildHierarchyScope(folderId, options, userId);
  const rows = await db.all<{ key: string; name: string; count: number; cover_id: number | null }>(
    `SELECT
       CASE WHEN series_key = '' THEN ? ELSE series_key END as key,
       CASE WHEN series_key = '' THEN 'Unsorted' ELSE series_key END as name,
       COUNT(*) as count,
       MIN(id) as cover_id
     FROM (
       SELECT c.id, COALESCE(NULLIF(TRIM(c.series_name), ''), '') as series_key
       FROM comics c ${scope.joins}
       ${scope.where}
     ) scoped
     GROUP BY series_key
     ORDER BY CASE WHEN series_key = '' THEN 1 ELSE 0 END, lower(series_key)`,
    [FOLDER_GROUP_NONE_KEY, ...scope.params],
  );

  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    count: row.count,
    coverComicId: row.cover_id,
  }));
}

export async function getScopedVolumeGroups(
  db: Db,
  userId: number | null,
  folderId: number | null,
  seriesKey: string,
  options: FolderHierarchyOptions,
): Promise<FolderVolumeGroup[]> {
  const scope = buildHierarchyScope(folderId, options, userId);
  const extra: string[] = [];
  const params = [...scope.params];
  addSeriesFilter(extra, params, seriesKey);

  const rows = await db.all<{
    volume_number: number | null;
    count: number;
    chapter_count: number;
    cover_id: number | null;
    single_comic_id: number | null;
  }>(
    `SELECT c.volume_number,
            COUNT(*) as count,
            COUNT(DISTINCT c.chapter_number) as chapter_count,
            MIN(c.id) as cover_id,
            CASE WHEN COUNT(*) = 1 THEN MIN(c.id) ELSE NULL END as single_comic_id
     FROM comics c ${scope.joins}
     ${scope.where} AND ${extra.join(' AND ')}
     GROUP BY c.volume_number
     ORDER BY CASE WHEN c.volume_number IS NULL THEN 1 ELSE 0 END, c.volume_number ASC`,
    params,
  );

  return rows.map((row) => ({
    key: numericGroupKey(row.volume_number),
    label: formatNumberLabel(row.volume_number, 'Unnumbered Volume', 'Volume'),
    volumeNumber: row.volume_number,
    count: row.count,
    chapterCount: row.chapter_count,
    coverComicId: row.cover_id,
    singleComicId: row.single_comic_id,
  }));
}

export async function getScopedChapterGroups(
  db: Db,
  userId: number | null,
  folderId: number | null,
  seriesKey: string,
  volumeKey: string,
  options: FolderHierarchyOptions,
): Promise<FolderChapterGroup[]> {
  const scope = buildHierarchyScope(folderId, options, userId);
  const extra: string[] = [];
  const params = [...scope.params];
  addSeriesFilter(extra, params, seriesKey);
  addNumberFilter(extra, params, 'volume_number', volumeKey);

  const rows = await db.all<{
    chapter_number: number | null;
    count: number;
    cover_id: number | null;
    single_comic_id: number | null;
  }>(
    `SELECT c.chapter_number,
            COUNT(*) as count,
            MIN(c.id) as cover_id,
            CASE WHEN COUNT(*) = 1 THEN MIN(c.id) ELSE NULL END as single_comic_id
     FROM comics c ${scope.joins}
     ${scope.where} AND ${extra.join(' AND ')}
     GROUP BY c.chapter_number
     ORDER BY CASE WHEN c.chapter_number IS NULL THEN 1 ELSE 0 END, c.chapter_number ASC`,
    params,
  );

  return rows.map((row) => ({
    key: numericGroupKey(row.chapter_number),
    label: formatNumberLabel(row.chapter_number, 'Unnumbered Chapter', 'Chapter'),
    chapterNumber: row.chapter_number,
    count: row.count,
    coverComicId: row.cover_id,
    singleComicId: row.single_comic_id,
  }));
}

export async function getScopedVolumeComicsForUser(
  db: Db,
  userId: number | null,
  folderId: number | null,
  seriesKey: string,
  volumeKey: string,
  chapterKey: string | null,
  options: FolderHierarchyOptions,
): Promise<FolderVolumeComicsResult> {
  const scope = buildHierarchyScope(folderId, options, userId);
  const extra: string[] = [];
  const params = [...scope.params];
  addSeriesFilter(extra, params, seriesKey);
  addNumberFilter(extra, params, 'volume_number', volumeKey);
  if (chapterKey != null) addNumberFilter(extra, params, 'chapter_number', chapterKey);

  const where = `${scope.where} AND ${extra.join(' AND ')}`;
  const { limit, offset } = resolvePaging(options);

  const countRow = await db.get<CountRow>(`SELECT COUNT(*) as cnt FROM comics c ${scope.joins} ${where}`, params);
  const totalCount = countRow?.cnt ?? 0;

  const rows = await db.all<UserComicListRow>(
    `SELECT ${COMIC_LIST_COLUMNS},
            ${userOverlaySelect(userId)}
     FROM comics c ${scope.joins}
     ${where}
     ORDER BY CASE WHEN c.chapter_number IS NULL THEN 1 ELSE 0 END,
              c.chapter_number ASC,
              lower(c.title) ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return {
    records: rows.map((row) => applyUserState(row, rowToListRecord(row), userId)),
    totalCount,
  };
}
