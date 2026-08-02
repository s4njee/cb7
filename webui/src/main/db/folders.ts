import type { ComicListRow, CountRow } from './types';
import { COMIC_LIST_COLUMNS } from './types';
import { rowToListRecord } from './comics';
import type { Db, PgDatabase } from './pg';
import type { QueryOptions, QueryResult } from '../../shared/types';
import {
  resolvePaging,
  resolveSort,
} from './comicQueryHelpers';
import { buildFolderComicsWhere } from './folderComicQueryHelpers';
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
  initialFolderCoverUpdateId,
  resolveFolderMediaType,
  type FolderMediaType,
} from './folderRecordHelpers';

/**
 * @module
 * Folder Hierarchy and Membership Database Operations
 *
 * Architecture overview for Junior Devs:
 * This module manages `folders`, `folder_comics`, and complex hierarchy grouping.
 * The library UI presents comics grouped by Series -> Volume -> Chapter.
 *
 * Hierarchy Core:
 * Rather than duplicating the complex tree-building logic for "All Library Comics" and
 * "Comics in a Specific Folder", we use a shared `buildHierarchyScope` method. If `folderId`
 * is null, the scope is global. If `folderId` is set, it restricts the SQL query to that folder.
 * This ensures the global browse view and folder view behave identically.
 */

export { FOLDER_GROUP_NONE_KEY } from './folderHierarchyHelpers';
export type { FolderChapterGroup, FolderSeriesGroup, FolderVolumeGroup } from './folderHierarchyQueries';

async function insertFolderComicMemberships(
  db: Db,
  folderId: number,
  comicIds: number[],
): Promise<void> {
  for (const id of comicIds) {
    await db.run('INSERT INTO folder_comics (folder_id, comic_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [folderId, id]);
  }
}

async function updateInitialFolderCover(
  db: Db,
  folderId: number,
  comicIds: number[],
): Promise<void> {
  const folder = await db.get<{ cover_comic_id: number | null }>('SELECT cover_comic_id FROM folders WHERE id = ?', [folderId]);
  const coverId = initialFolderCoverUpdateId(folder?.cover_comic_id, comicIds);
  if (coverId != null) {
    await db.run('UPDATE folders SET cover_comic_id = ? WHERE id = ?', [coverId, folderId]);
  }
}

async function addFolderMembershipsRaw(
  db: Db,
  folderId: number,
  comicIds: number[],
): Promise<void> {
  if (comicIds.length === 0) return;
  await insertFolderComicMemberships(db, folderId, comicIds);
  await updateInitialFolderCover(db, folderId, comicIds);
}

export async function createFolder(
  db: PgDatabase,
  name: string,
  comicIds: number[],
): Promise<{ id: number; name: string }> {
  const coverId = initialFolderCoverId(comicIds);
  const folderId = await db.tx(async (tx) => {
    const row = (await tx.get<{ id: number }>('INSERT INTO folders (name, cover_comic_id) VALUES (?, ?) RETURNING id', [name, coverId]))!;
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
): Promise<{ id: number; name: string; comicCount: number; hasCoverThumbnail: boolean; mediaType: FolderMediaType }[]> {
  const where = libraryId != null
    ? 'WHERE f.id IN (SELECT folder_id FROM library_folders WHERE library_id = ?)'
    : '';
  const params = libraryId != null ? [libraryId] : [];
  // Count comic vs book items per folder so the caller can decide whether a
  // folder is relevant for the current media-type filter. An empty folder is
  // neither and gets flagged so the sidebar can hide it. Callers only need to
  // know whether a cover exists, so the 1:1 cover join reduces to a boolean —
  // fetching (and GROUPing BY) the BYTEA blob itself pulled every folder's
  // cover image out of Postgres just to be thrown away.
  const rows = await db.all<{
    id: number; name: string; comic_count: number;
    n_comic: number | null; n_book: number | null;
    has_cover: boolean;
  }>(
    `SELECT f.id, f.name,
            COUNT(fc.comic_id) as comic_count,
            SUM(CASE WHEN ic.media_type = 'comic' THEN 1 ELSE 0 END) as n_comic,
            SUM(CASE WHEN ic.media_type = 'book'  THEN 1 ELSE 0 END) as n_book,
            (cc.cover_thumbnail IS NOT NULL) as has_cover
     FROM folders f
     LEFT JOIN folder_comics fc ON f.id = fc.folder_id
     LEFT JOIN comics ic ON fc.comic_id = ic.id
     LEFT JOIN comics cc ON f.cover_comic_id = cc.id
     ${where}
     GROUP BY f.id, (cc.cover_thumbnail IS NOT NULL)
     ORDER BY lower(f.name)`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    comicCount: r.comic_count,
    hasCoverThumbnail: Boolean(r.has_cover),
    mediaType: resolveFolderMediaType(r.comic_count, r.n_comic, r.n_book),
  }));
}

/**
 * Batched variant for the bulk ingest pipeline. Caller is already inside
 * a transaction (passes the tx handle), so this skips the wrapper. Resolves the
 * cover_comic_id once per call rather than once per row.
 */
export function addComicsToFolderRaw(db: Db, folderId: number, comicIds: number[]): Promise<void> {
  return addFolderMembershipsRaw(db, folderId, comicIds);
}

export async function addComicsToFolder(db: PgDatabase, folderId: number, comicIds: number[]): Promise<void> {
  if (comicIds.length === 0) return;
  await db.tx(async (tx) => {
    await addFolderMembershipsRaw(tx, folderId, comicIds);
  });
}

export async function removeComicsFromFolder(db: PgDatabase, folderId: number, comicIds: number[]): Promise<void> {
  await db.tx(async (tx) => {
    for (const id of comicIds) {
      await tx.run('DELETE FROM folder_comics WHERE folder_id = ? AND comic_id = ?', [folderId, id]);
    }
  });
}

export async function getFolderComics(
  db: Db,
  folderId: number,
  options: QueryOptions = {},
): Promise<QueryResult> {
  const { where, params } = buildFolderComicsWhere(folderId, options);
  const { sortCol, sortDir } = resolveSort(options, false);
  const { limit, offset } = resolvePaging(options);
  const countRow = await db.get<CountRow>(`SELECT COUNT(*) as cnt FROM comics c ${where}`, params);
  const totalCount = countRow?.cnt ?? 0;
  const rows = await db.all<ComicListRow>(
    `SELECT ${COMIC_LIST_COLUMNS}
     FROM comics c ${where}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { records: rows.map(rowToListRecord), totalCount };
}

/** Targeted single-folder cover thumbnail lookup (avoids loading all folders). */
export async function getFolderThumbnail(db: Db, folderId: number): Promise<Buffer | null> {
  const row = await db.get<{ thumb: Buffer | null }>(
    `SELECT cc.cover_thumbnail AS thumb
     FROM folders f
     LEFT JOIN comics cc ON f.cover_comic_id = cc.id
     WHERE f.id = ?`,
    [folderId],
  );
  return row?.thumb ?? null;
}

// --- Folder-scoped hierarchy (thin wrappers over the cores) ---

export function getFolderSeriesGroups(
  db: Db,
  userId: number | null,
  folderId: number,
  options: FolderHierarchyOptions = {},
): Promise<FolderSeriesGroup[]> {
  return getScopedSeriesGroups(db, userId, folderId, options);
}

export function getFolderVolumeGroups(
  db: Db,
  userId: number | null,
  folderId: number,
  seriesKey: string,
  options: FolderHierarchyOptions = {},
): Promise<FolderVolumeGroup[]> {
  return getScopedVolumeGroups(db, userId, folderId, seriesKey, options);
}

export function getFolderChapterGroups(
  db: Db,
  userId: number | null,
  folderId: number,
  seriesKey: string,
  volumeKey: string,
  options: FolderHierarchyOptions = {},
): Promise<FolderChapterGroup[]> {
  return getScopedChapterGroups(db, userId, folderId, seriesKey, volumeKey, options);
}

export function getFolderVolumeComicsForUser(
  db: Db,
  userId: number | null,
  folderId: number,
  seriesKey: string,
  volumeKey: string,
  chapterKey: string | null,
  options: FolderHierarchyOptions = {},
): Promise<FolderVolumeComicsResult> {
  return getScopedVolumeComicsForUser(db, userId, folderId, seriesKey, volumeKey, chapterKey, options);
}

export async function getComicFolderIds(db: Db, comicId: number): Promise<number[]> {
  const rows = await db.all<{ folder_id: number }>('SELECT folder_id FROM folder_comics WHERE comic_id = ?', [comicId]);
  return rows.map((r) => r.folder_id);
}

export async function getFolderFilePaths(db: Db, folderId: number): Promise<string[]> {
  const rows = await db.all<{ file_path: string }>(
    'SELECT c.file_path FROM comics c JOIN folder_comics fc ON fc.comic_id = c.id WHERE fc.folder_id = ?',
    [folderId],
  );
  return rows.map((r) => r.file_path);
}

// --- Global (library-wide) hierarchy — same cores, no folder scope. Used by
// the search/browse view. ---

export function getGlobalSeriesGroups(
  db: Db,
  userId: number | null,
  options: FolderHierarchyOptions = {},
): Promise<FolderSeriesGroup[]> {
  return getScopedSeriesGroups(db, userId, null, options);
}

export function getGlobalVolumeGroups(
  db: Db,
  userId: number | null,
  seriesKey: string,
  options: FolderHierarchyOptions = {},
): Promise<FolderVolumeGroup[]> {
  return getScopedVolumeGroups(db, userId, null, seriesKey, options);
}

export function getGlobalChapterGroups(
  db: Db,
  userId: number | null,
  seriesKey: string,
  volumeKey: string,
  options: FolderHierarchyOptions = {},
): Promise<FolderChapterGroup[]> {
  return getScopedChapterGroups(db, userId, null, seriesKey, volumeKey, options);
}

export function getGlobalVolumeComicsForUser(
  db: Db,
  userId: number | null,
  seriesKey: string,
  volumeKey: string,
  chapterKey: string | null,
  options: FolderHierarchyOptions = {},
): Promise<FolderVolumeComicsResult> {
  return getScopedVolumeComicsForUser(db, userId, null, seriesKey, volumeKey, chapterKey, options);
}
