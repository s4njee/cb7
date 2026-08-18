import type { ComicListRow, CountRow } from './types';
import { COMIC_LIST_COLUMNS } from './types';
import { rowToListRecord } from './comicRowMappers';
import type { Db, PgDatabase } from './pg';
import type { QueryOptions, QueryResult } from '../../shared/types';
import {
  resolvePaging,
  resolveSort,
} from './comicQueryHelpers';
import { buildFolderComicsWhere } from './folderComicQueryHelpers';
import { comicIsVisible, comicVisibilityCondition } from './libraryAccess';
import type { FolderHierarchyOptions } from './folderHierarchyScope';
import {
  getScopedChapterGroups,
  getScopedSeriesGroups,
  getScopedVolumeComicsForUser,
  getScopedVolumeGroups,
  type FolderChapterGroup,
  type FolderSeriesGroup,
  type FolderVolumeComicsResult,
  type FolderVolumeGroup,
} from './folderHierarchyQueries';
import {
  initialFolderCoverId,
  resolveFolderMediaType,
  type FolderMediaType,
} from './folderRecordHelpers';
import { insertFolderComicMemberships } from './folderMemberships';

export { FOLDER_GROUP_NONE_KEY } from './folderHierarchyHelpers';
export type { FolderChapterGroup, FolderSeriesGroup, FolderVolumeGroup } from './folderHierarchyQueries';

// Re-export submodules for 100% backward compatibility
export * from './folderRoots';
export * from './folderMemberships';

/**
 * @module
 * Folder Hierarchy and Membership Database Operations
 */

export async function createFolder(
  db: PgDatabase,
  name: string,
  comicIds: number[],
  scanPath?: string | null,
): Promise<{ id: number; name: string }> {
  const coverId = initialFolderCoverId(comicIds);
  const folderId = await db.tx(async (tx) => {
    const row = (await tx.get<{ id: number }>(
      'INSERT INTO folders (name, cover_comic_id, scan_path) VALUES (?, ?, ?) RETURNING id',
      [name, coverId, scanPath ?? null],
    ))!;
    if (comicIds.length > 0) await insertFolderComicMemberships(tx, row.id, comicIds);
    return row.id;
  });
  return { id: folderId, name };
}

export async function renameFolder(db: Db, id: number, newName: string): Promise<void> {
  await db.run('UPDATE folders SET name = ? WHERE id = ?', [newName, id]);
}

export async function deleteFolder(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM folders WHERE id = ?', [id]);
}

export async function getAllFolders(
  db: Db,
  libraryId?: number | null,
): Promise<{
  id: number; name: string; comicCount: number; hasCoverThumbnail: boolean;
  mediaType: FolderMediaType; scanPath: string | null; autoScanEnabled: boolean;
}[]> {
  const where = libraryId != null
    ? 'WHERE f.id IN (SELECT folder_id FROM library_folders WHERE library_id = ?)'
    : '';
  const params = libraryId != null ? [libraryId] : [];
  const rows = await db.all<{
    id: number; name: string; comic_count: number;
    n_comic: number | null; n_book: number | null;
    has_cover: boolean; scan_path: string | null; auto_scan_enabled: number;
  }>(
    `SELECT f.id, f.name, f.scan_path, f.auto_scan_enabled,
            COUNT(fc.comic_id) as comic_count,
            SUM(CASE WHEN ic.media_type = 'comic' THEN 1 ELSE 0 END) as n_comic,
            SUM(CASE WHEN ic.media_type = 'book'  THEN 1 ELSE 0 END) as n_book,
            (cc.cover_thumbnail IS NOT NULL
              OR EXISTS (SELECT 1 FROM comic_covers fcc WHERE fcc.comic_id = cc.id)) as has_cover
     FROM folders f
     LEFT JOIN folder_comics fc ON f.id = fc.folder_id
     LEFT JOIN comics ic ON fc.comic_id = ic.id
     LEFT JOIN comics cc ON f.cover_comic_id = cc.id
     ${where}
     GROUP BY f.id, (cc.cover_thumbnail IS NOT NULL
       OR EXISTS (SELECT 1 FROM comic_covers fcc WHERE fcc.comic_id = cc.id))
     ORDER BY lower(f.name)`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    comicCount: r.comic_count,
    hasCoverThumbnail: Boolean(r.has_cover),
    mediaType: resolveFolderMediaType(r.comic_count, r.n_comic, r.n_book),
    scanPath: r.scan_path,
    autoScanEnabled: r.auto_scan_enabled === 1,
  }));
}

export async function getFolderComics(
  db: Db,
  folderId: number,
  options: QueryOptions = {},
  userId?: number | null,
  admin?: boolean,
): Promise<QueryResult> {
  const { where, params } = buildFolderComicsWhere(folderId, options);
  const conditions: string[] = [];
  if (admin !== true) {
    const visibility = comicVisibilityCondition(userId ?? null);
    conditions.push(visibility.sql);
    params.push(...visibility.params);
  }
  const whereWithVisibility = conditions.length > 0
    ? `${where} AND ${conditions.join(' AND ')}`
    : where;
  const { sortCol, sortDir } = resolveSort(options, false);
  const { limit, offset } = resolvePaging(options);
  const countRow = await db.get<CountRow>(`SELECT COUNT(*) as cnt FROM comics c ${whereWithVisibility}`, params);
  const totalCount = countRow?.cnt ?? 0;
  const rows = await db.all<ComicListRow>(
    `SELECT ${COMIC_LIST_COLUMNS}
     FROM comics c ${whereWithVisibility}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { records: rows.map(rowToListRecord), totalCount };
}

/** Targeted single-folder cover thumbnail lookup (avoids loading all folders). */
export async function getFolderThumbnail(
  db: Db,
  folderId: number,
  userId: number | null = null,
  admin = false,
): Promise<Buffer | null> {
  const row = await db.get<{ thumb: Buffer | null; cover_comic_id: number | null }>(
    `SELECT f.cover_comic_id,
            COALESCE(
              (SELECT fcc.data FROM comic_covers fcc WHERE fcc.comic_id = cc.id),
              cc.cover_thumbnail) AS thumb
     FROM folders f
     LEFT JOIN comics cc ON f.cover_comic_id = cc.id
     WHERE f.id = ?`,
    [folderId],
  );
  if (!row?.thumb) return null;
  if (admin !== true && row.cover_comic_id != null) {
    const visible = await comicIsVisible(db, row.cover_comic_id, userId);
    if (!visible) return null;
  }
  return row.thumb;
}

export function getFolderSeriesGroups(
  db: Db,
  userId: number | null,
  folderId: number,
  options: FolderHierarchyOptions = {},
  admin?: boolean,
): Promise<FolderSeriesGroup[]> {
  return getScopedSeriesGroups(db, userId, folderId, { ...options, admin });
}

export function getFolderVolumeGroups(
  db: Db,
  userId: number | null,
  folderId: number,
  seriesName: string,
  options: FolderHierarchyOptions = {},
  admin?: boolean,
): Promise<FolderVolumeGroup[]> {
  return getScopedVolumeGroups(db, userId, folderId, seriesName, { ...options, admin });
}

export function getFolderChapterGroups(
  db: Db,
  userId: number | null,
  folderId: number,
  seriesName: string,
  volumeNumber: string,
  options: FolderHierarchyOptions = {},
  admin?: boolean,
): Promise<FolderChapterGroup[]> {
  return getScopedChapterGroups(db, userId, folderId, seriesName, volumeNumber, { ...options, admin });
}

export function getFolderVolumeComicsForUser(
  db: Db,
  userId: number | null,
  folderId: number,
  seriesName: string,
  volumeNumber: string,
  chapterNumber: string | null,
  options: QueryOptions = {},
  admin?: boolean,
): Promise<FolderVolumeComicsResult> {
  return getScopedVolumeComicsForUser(db, userId, folderId, seriesName, volumeNumber, chapterNumber, { ...options, admin });
}

export function getGlobalSeriesGroups(
  db: Db,
  userId: number | null,
  options: FolderHierarchyOptions = {},
  admin?: boolean,
): Promise<FolderSeriesGroup[]> {
  return getScopedSeriesGroups(db, userId, null, { ...options, admin });
}

export function getGlobalVolumeGroups(
  db: Db,
  userId: number | null,
  seriesName: string,
  options: FolderHierarchyOptions = {},
  admin?: boolean,
): Promise<FolderVolumeGroup[]> {
  return getScopedVolumeGroups(db, userId, null, seriesName, { ...options, admin });
}

export function getGlobalChapterGroups(
  db: Db,
  userId: number | null,
  seriesName: string,
  volumeNumber: string,
  options: FolderHierarchyOptions = {},
  admin?: boolean,
): Promise<FolderChapterGroup[]> {
  return getScopedChapterGroups(db, userId, null, seriesName, volumeNumber, { ...options, admin });
}

export function getGlobalVolumeComicsForUser(
  db: Db,
  userId: number | null,
  seriesName: string,
  volumeNumber: string,
  chapterNumber: string | null,
  options: QueryOptions = {},
  admin?: boolean,
): Promise<FolderVolumeComicsResult> {
  return getScopedVolumeComicsForUser(db, userId, null, seriesName, volumeNumber, chapterNumber, { ...options, admin });
}
