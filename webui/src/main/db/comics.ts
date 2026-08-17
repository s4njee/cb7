import type { MediaRecord } from '../../shared/types';
import type { ComicRow, ComicListRow, CountRow } from './types';
import { NOW_TEXT_SQL, type Db, type PgDatabase } from './pg';
import type { EmbeddedMetadata } from '../embeddedMetadata';
import {
  addUserReadStatusFilter,
  buildComicFilters,
  buildUserComicOverlaySql,
  buildWhere,
  resolvePaging,
  resolveSort,
  type ComicFilterOptions,
} from './comicQueryHelpers';
import {
  buildComicMetadataUpdate,
  rowToComicMetadata,
  type ComicMetadata,
  type ComicMetadataRow,
  type ComicMetadataUpdateFields,
} from './comicMetadataHelpers';
import { COMIC_FULL_COLUMNS, COMIC_LIST_COLUMNS, COMIC_NO_BLOB_COLUMNS } from './types';
import { addTag } from './tags';
import { comicVisibilityCondition } from './libraryAccess';
import {
  getTagsByComicId,
  withBatchedTags,
  rowToRecordBase,
  rowToRecord,
  rowsToRecords,
  rowToListRecord,
} from './comicRowMappers';
import { setComicCover } from './comicCovers';

// Re-export extracted helpers for 100% backward compatibility
export * from './comicRowMappers';
export * from './comicDuplicates';
export * from './comicCovers';
export * from './comicSeries';
export * from './comicReading';

/**
 * @module
 * Comics Database Operations
 *
 * Architecture overview for Junior Devs:
 * This module handles core SQL queries related to the `comics` table (CRUD,
 * metadata updates, and `queryComicsForUser`). Specialized sub-domains are split
 * into helper modules (`comicDuplicates`, `comicCovers`, `comicSeries`,
 * `comicReading`, `comicRowMappers`) and re-exported here.
 */

export type UserComicQueryOptions = ComicFilterOptions & {
  favorites?: boolean;
  /** Admins bypass per-user library access and see the whole catalog. */
  admin?: boolean;
};

type UserComicListRow = ComicListRow & {
  up_last_page: number | null;
  up_last_location: string | null;
  up_last_percent: number | null;
  up_last_read: string | null;
  up_completed: number;
  is_fav: number;
};

export type ComicSource = 'scan' | 'upload';

/**
 * Metadata columns `addComicFast` writes from a caller-supplied
 * `metadata` object (P1-3 embedded metadata). Only fields that are present
 * (not `undefined`) become columns; `undefined` values bind as NULL.
 */
const ADD_COMIC_METADATA_COLUMNS: Array<{
  field: 'author' | 'artist' | 'genre' | 'year' | 'summary' | 'language' | 'publisher';
  column: string;
}> = [
  { field: 'author', column: 'author' },
  { field: 'artist', column: 'artist' },
  { field: 'genre', column: 'genre' },
  { field: 'year', column: 'year' },
  { field: 'summary', column: 'summary' },
  { field: 'language', column: 'language' },
  { field: 'publisher', column: 'publisher' },
];

/** Embedded-metadata fields `addComicFast` can persist at insert time. */
export interface AddComicFastMetadata {
  author?: string | null;
  artist?: string | null;
  genre?: string | null;
  year?: number | null;
  summary?: string | null;
  language?: string | null;
  publisher?: string | null;
}

export async function addComicFast(
  db: Db,
  record: {
    filePath: string;
    title: string;
    pageCount: number;
    fileSize: number;
    coverThumbnail: Buffer;
    mediaType: 'comic' | 'book';
    source?: ComicSource;
    contentHash?: string | null;
    metadata?: AddComicFastMetadata;
    tags?: string[];
  },
): Promise<number> {
  await db.run('DELETE FROM dismissed_paths WHERE file_path = ?', [record.filePath]);

  // Write the non-undefined metadata columns into the INSERT (P1-3). The static
  // last_page/last_location/last_read NULL literals stay put; metadata columns
  // (and their bound values) are appended when the caller supplied them.
  const metadataColumns: string[] = [];
  const metadataValues: (string | number | null)[] = [];
  const md = record.metadata;
  if (md) {
    for (const { field, column } of ADD_COMIC_METADATA_COLUMNS) {
      const value = md[field];
      if (value !== undefined) {
        metadataColumns.push(column);
        metadataValues.push(value);
      }
    }
  }
  const metadataColumnsSql = metadataColumns.length ? `, ${metadataColumns.join(', ')}` : '';
  const metadataValuesSql = metadataValues.length ? `, ${metadataValues.map(() => '?').join(', ')}` : '';

  const row = (await db.get<{ id: number }>(
    `INSERT INTO comics (file_path, title, page_count, file_size, source, content_hash, last_page, last_location, last_read, media_type${metadataColumnsSql})
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?${metadataValuesSql}) RETURNING id`,
    [record.filePath, record.title, record.pageCount, record.fileSize, record.source ?? 'scan', record.contentHash ?? null, record.mediaType, ...metadataValues],
  ))!;
  // Cover goes to the comic_covers table (P0-3), not the legacy column.
  await setComicCover(db, row.id, record.coverThumbnail);

  if (record.tags?.length) {
    for (const tag of record.tags) {
      await addTag(db, row.id, tag);
    }
  }
  return row.id;
}

export async function addComic(
  db: Db,
  record: Omit<MediaRecord, 'id' | 'dateAdded'> & { source?: ComicSource; contentHash?: string | null },
): Promise<MediaRecord> {
  await db.run('DELETE FROM dismissed_paths WHERE file_path = ?', [record.filePath]);
  const inserted = (await db.get<{ id: number }>(
    `INSERT INTO comics (file_path, title, page_count, file_size, source, content_hash, last_page, last_location, last_read, media_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      record.filePath,
      record.title,
      record.pageCount,
      record.fileSize,
      record.source ?? 'scan',
      record.contentHash ?? null,
      record.lastPage,
      record.lastLocation,
      record.lastRead,
      record.mediaType ?? 'comic',
    ],
  ))!;
  const id = inserted.id;
  // Cover goes to the comic_covers table (P0-3), not the legacy column.
  if (record.coverThumbnail) await setComicCover(db, id, record.coverThumbnail);

  if (record.tags?.length) {
    for (const tag of record.tags) {
      await addTag(db, id, tag);
    }
  }

  return (await getComic(db, id))!;
}

export async function removeComics(db: PgDatabase, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all<{ file_path: string; source: string }>(
    `SELECT file_path, source FROM comics WHERE id IN (${placeholders})`,
    ids,
  );
  await db.tx(async (tx) => {
    for (const row of rows) {
      // Dismiss markers only make sense for scanned library paths — they stop
      // a rescan from re-adding a file the user removed. Upload-sourced files
      // are deleted along with their record, so there is nothing to dismiss and
      // leaving a marker would silently block a future re-upload of that file.
      if (row.source !== 'upload') {
        await tx.run('INSERT INTO dismissed_paths (file_path) VALUES (?) ON CONFLICT DO NOTHING', [row.file_path]);
      }
    }
    await tx.run(`DELETE FROM comics WHERE id IN (${placeholders})`, ids);
  });
}

/**
 * File-path + origin for the given ids.
 */
export async function getComicSources(
  db: Db,
  ids: number[],
): Promise<Array<{ id: number; filePath: string; source: ComicSource }>> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all<{ id: number; file_path: string; source: string }>(
    `SELECT id, file_path, source FROM comics WHERE id IN (${placeholders})`,
    ids,
  );
  return rows.map((r) => ({ id: r.id, filePath: r.file_path, source: r.source === 'upload' ? 'upload' : 'scan' }));
}

export async function isDismissed(db: Db, filePath: string): Promise<boolean> {
  const row = await db.get('SELECT 1 FROM dismissed_paths WHERE file_path = ?', [filePath]);
  return row !== undefined;
}

export async function getComic(db: Db, id: number): Promise<MediaRecord | null> {
  const row = await db.get<ComicRow>(`SELECT ${COMIC_FULL_COLUMNS} FROM comics WHERE id = ?`, [id]);
  if (!row) return null;
  return rowToRecord(db, row);
}

/**
 * Fetch a comic without the cover blob or tags — one light query.
 */
export async function getComicLite(db: Db, id: number): Promise<MediaRecord | null> {
  const row = await db.get<ComicRow>(`SELECT ${COMIC_NO_BLOB_COLUMNS} FROM comics WHERE id = ?`, [id]);
  if (!row) return null;
  return rowToRecordBase(row, []);
}

export async function comicExistsByPath(db: Db, filePath: string): Promise<boolean> {
  const row = await db.get('SELECT 1 FROM comics WHERE file_path = ?', [filePath]);
  return row !== undefined;
}

/**
 * Stamp a comic as missing on disk (P1-8). Idempotent — re-marking an already
 * missing row just refreshes `missing_at`. Called by the post-scan sweep and by
 * media reads that hit ENOENT.
 */
export async function markComicMissing(db: Db, comicId: number): Promise<void> {
  await db.run(`UPDATE comics SET missing_at = ${NOW_TEXT_SQL} WHERE id = ?`, [comicId]);
}

/**
 * Clear the missing-on-disk flag when the file returns (P1-8). Idempotent.
 */
export async function clearComicMissing(db: Db, comicId: number): Promise<void> {
  await db.run('UPDATE comics SET missing_at = NULL WHERE id = ?', [comicId]);
}

/**
 * Post-scan sweep (P1-8): for every catalog row under a library root, check the
 * file on disk and stamp/clear `missing_at` accordingly. Runs after a full scan
 * so a deleted file is badged as missing and a re-added one is restored without
 * needing a rescan to re-import it. Errors are batched into two `IN (...)` UPDATEs
 * (one for marking, one for clearing) instead of one query per row.
 * @returns How many rows were marked missing vs cleared.
 */
export async function refreshMissingUnderRoot(
  db: Db,
  rootPath: string,
): Promise<{ marked: number; cleared: number }> {
  const rows = await db.all<{ id: number; file_path: string }>(
    'SELECT id, file_path FROM comics WHERE file_path = ? OR file_path LIKE ?',
    [rootPath, rootPath + '/%'],
  );
  const toMark: number[] = [];
  const toClear: number[] = [];
  const fsp = await import('node:fs/promises');
  for (const row of rows) {
    try {
      await fsp.access(row.file_path);
      toClear.push(row.id);
    } catch {
      toMark.push(row.id);
    }
  }
  if (toMark.length > 0) await setMissingFlagBatch(db, toMark, true);
  if (toClear.length > 0) await setMissingFlagBatch(db, toClear, false);
  return { marked: toMark.length, cleared: toClear.length };
}

async function setMissingFlagBatch(db: Db, ids: number[], missing: boolean): Promise<void> {
  const placeholders = ids.map(() => '?').join(',');
  const flag = missing ? `missing_at = ${NOW_TEXT_SQL}` : 'missing_at = NULL';
  await db.run(`UPDATE comics SET ${flag} WHERE id IN (${placeholders})`, ids);
}

/**
 * Delete every catalog row whose file is currently missing from disk (P1-8).
 * Goes through `removeComics`, which inserts `dismissed_paths` markers for
 * scan-sourced rows so a rescan won't immediately re-add them.
 * @returns How many rows were removed.
 */
export async function pruneMissingComics(db: PgDatabase): Promise<number> {
  const rows = await db.all<{ id: number }>('SELECT id FROM comics WHERE missing_at IS NOT NULL');
  const ids = rows.map((r) => r.id);
  await removeComics(db, ids);
  return ids.length;
}

/**
 * Repoint a comic's catalog row at a new file on disk (Locate, P1-8). Clears the
 * missing flag, stores the freshly-hashed content (for duplicate detection), and
 * removes any dismissed-path marker for the new path. `source` is forced to
 * 'scan' deliberately so a later delete never unlinks a user's file — the
 * repointed file lives on the host, not in the upload store.
 */
export async function relocateComicPath(
  db: Db,
  comicId: number,
  newPath: string,
  newHash: string | null,
): Promise<void> {
  await db.run(
    `UPDATE comics SET file_path = ?, content_hash = ?, missing_at = NULL, source = 'scan' WHERE id = ?`,
    [newPath, newHash, comicId],
  );
  await db.run('DELETE FROM dismissed_paths WHERE file_path = ?', [newPath]);
}

export async function updatePageCountByPath(db: Db, filePath: string, pageCount: number): Promise<void> {
  await db.run('UPDATE comics SET page_count = ? WHERE file_path = ?', [pageCount, filePath]);
}

export async function getComicByPath(db: Db, filePath: string): Promise<MediaRecord | null> {
  const row = await db.get<ComicRow>(`SELECT ${COMIC_FULL_COLUMNS} FROM comics WHERE file_path = ?`, [filePath]);
  if (!row) return null;
  return rowToRecord(db, row);
}

export async function updateComicMetadata(
  db: Db,
  comicId: number,
  fields: ComicMetadataUpdateFields,
): Promise<void> {
  const update = buildComicMetadataUpdate(fields);
  if (update.assignments.length === 0) return;
  await db.run(`UPDATE comics SET ${update.assignments.join(', ')} WHERE id = ?`, [...update.values, comicId]);
}

export async function getComicMetadata(
  db: Db,
  id: number,
): Promise<ComicMetadata | null> {
  const row = await db.get<ComicMetadataRow>(
    `SELECT author, artist, genre, year, summary,
            language, publisher,
            external_id, external_source, series_name, volume_number, chapter_number
     FROM comics
     WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return rowToComicMetadata(row);
}

/**
 * Fill only the metadata fields that are currently NULL from a file's embedded
 * metadata (P1-3). Every present embedded field whose column is null is written
 * via `updateComicMetadata` (which maps the series fields through
 * `buildComicMetadataUpdate`); tags are attached only when the comic has no
 * tags yet and the file provided some.
 * @param db The database handle.
 * @param comicId The comic to fill.
 * @param embedded The embedded metadata read from the file.
 * @returns A map of field name -> value actually written (e.g.
 *          `{ author: 'X', seriesName: 'S', tags: 'A, B' }`), for the route to
 *          tell the UI what changed. Empty when nothing was applied.
 */
export async function fillNullMetadataFromEmbedded(
  db: Db,
  comicId: number,
  embedded: EmbeddedMetadata,
): Promise<Record<string, string | number | null>> {
  const metadata = await getComicMetadata(db, comicId);
  if (!metadata) return {};

  const applied: Record<string, string | number | null> = {};

  // Field pairs: [embedded field, metadata update field]. Series fields go
  // through the same `updateComicMetadata` path — buildComicMetadataUpdate
  // maps them to series_name/volume_number/chapter_number.
  const fieldPairs: Array<[keyof EmbeddedMetadata, keyof ComicMetadata]> = [
    ['author', 'author'],
    ['artist', 'artist'],
    ['genre', 'genre'],
    ['year', 'year'],
    ['summary', 'summary'],
    ['language', 'language'],
    ['publisher', 'publisher'],
    ['seriesName', 'seriesName'],
    ['volumeNumber', 'volumeNumber'],
    ['chapterNumber', 'chapterNumber'],
  ];

  const updates: ComicMetadataUpdateFields = {};
  for (const [embeddedKey, metaKey] of fieldPairs) {
    const value = embedded[embeddedKey];
    if (value === undefined) continue; // field unknown to the file
    if (metadata[metaKey] !== null) continue; // already filled
    updates[metaKey] = value as never;
    applied[metaKey] = value as string | number | null;
  }
  if (Object.keys(updates).length > 0) {
    await updateComicMetadata(db, comicId, updates);
  }

  // Tags: only when the comic currently has no tags and the file provided some.
  const hasAnyTag = await db.get<{ n: number }>(
    'SELECT 1 as n FROM comic_tags WHERE comic_id = ? LIMIT 1',
    [comicId],
  );
  if (!hasAnyTag && embedded.tags && embedded.tags.length > 0) {
    for (const tag of embedded.tags) {
      await addTag(db, comicId, tag);
    }
    applied.tags = embedded.tags.join(', ');
  }

  return applied;
}

export async function queryComicsForUser(
  db: Db,
  userId: number | null,
  options: UserComicQueryOptions,
): Promise<{ records: (MediaRecord & { favorited?: boolean })[]; totalCount: number }> {
  const { conditions, params } = buildComicFilters(options, { includeSharedReadStatus: userId == null });
  const userOverlay = buildUserComicOverlaySql(userId);

  if (options.readStatus && userId != null) {
    addUserReadStatusFilter(conditions, options.readStatus);
  }

  if (options.favorites && userId != null) {
    conditions.push('uf.comic_id IS NOT NULL');
  }

  if (!options.admin) {
    const visibility = comicVisibilityCondition(userId);
    conditions.push(visibility.sql);
    params.push(...visibility.params);
  }

  const where = buildWhere(conditions);
  const { sortCol, sortDir } = resolveSort(options, userId != null);
  const { limit, offset } = resolvePaging(options);

  const allParams = [...userOverlay.joinParams, ...params];

  const countNeedsOverlay = userId != null && (Boolean(options.readStatus) || Boolean(options.favorites));
  const countSql = countNeedsOverlay
    ? `SELECT COUNT(*) as cnt FROM comics c ${userOverlay.progressJoin} ${userOverlay.favoriteJoin} ${where}`
    : `SELECT COUNT(*) as cnt FROM comics c ${where}`;
  const countRow = await db.get<CountRow>(countSql, countNeedsOverlay ? allParams : params);
  const totalCount = countRow?.cnt ?? 0;

  const rowsSql = `SELECT ${COMIC_LIST_COLUMNS},
                          ${userOverlay.progressSelect}, ${userOverlay.favoriteSelect}
                   FROM comics c ${userOverlay.progressJoin} ${userOverlay.favoriteJoin}
                   ${where}
                   ORDER BY ${sortCol} ${sortDir}
                   LIMIT ? OFFSET ?`;
  const rows = await db.all<UserComicListRow>(rowsSql, [...allParams, limit, offset]);

  const baseRecords = await withBatchedTags(db, rows.map((r) => rowToListRecord(r as any)));
  const records = baseRecords.map((base, index) => {
    const row = rows[index];
    const hasUserProgress = userId != null && row.up_last_read != null;
    return {
      ...base,
      lastPage: hasUserProgress ? row.up_last_page : base.lastPage,
      lastLocation: hasUserProgress ? row.up_last_location : base.lastLocation,
      lastPercent: hasUserProgress ? row.up_last_percent : base.lastPercent,
      lastRead: hasUserProgress ? row.up_last_read : base.lastRead,
      favorited: Boolean(row.is_fav),
    };
  });

  return { records, totalCount };
}

/**
 * Select-all support: return the ids of every comic matching the same filters
 * `queryComicsForUser` accepts, capped for safety. The batch UI ("select all
 * matching") uses this to target hundreds of items at once without paging
 * through full records. Honors the same per-user overlay (read status,
 * favorites) and library-visibility rules as the list query.
 * @param db The database handle.
 * @param userId Current user id, or null for shared/anonymous state.
 * @param options The same filter options `queryComicsForUser` accepts.
 * @param cap Maximum number of ids to return (default 2000).
 * @returns The matching ids (ascending), the true total match count, and
 *          whether the ids were truncated at `cap`.
 */
export async function queryComicIdsForUser(
  db: Db,
  userId: number | null,
  options: UserComicQueryOptions,
  cap: number = 2000,
): Promise<{ ids: number[]; totalCount: number; truncated: boolean }> {
  const { conditions, params } = buildComicFilters(options, { includeSharedReadStatus: userId == null });
  const overlay = buildUserComicOverlaySql(userId);

  if (options.readStatus && userId != null) {
    addUserReadStatusFilter(conditions, options.readStatus);
  }

  if (options.favorites && userId != null) {
    conditions.push('uf.comic_id IS NOT NULL');
  }

  if (!options.admin) {
    const visibility = comicVisibilityCondition(userId);
    conditions.push(visibility.sql);
    params.push(...visibility.params);
  }

  const where = buildWhere(conditions);
  const allParams = [...overlay.joinParams, ...params];

  const countRow = await db.get<CountRow>(
    `SELECT COUNT(*) as cnt FROM comics c ${overlay.progressJoin} ${overlay.favoriteJoin} ${where}`,
    allParams,
  );
  const totalCount = countRow?.cnt ?? 0;

  const rows = await db.all<{ id: number }>(
    `SELECT c.id FROM comics c ${overlay.progressJoin} ${overlay.favoriteJoin} ${where} ORDER BY c.id LIMIT ?`,
    [...allParams, Math.max(1, cap)],
  );

  return { ids: rows.map((r) => r.id), totalCount, truncated: totalCount > rows.length };
}

/**
 * Update metadata on many comics at once. Idempotent: loops each id through the
 * existing single-row `updateComicMetadata`, which no-ops when the fields object
 * has no present (non-undefined) assignments. Used by the batch-edit endpoint.
 * @param db The database handle.
 * @param ids Comic ids to update.
 * @param fields Partial metadata fields (undefined = leave unchanged).
 */
export async function updateComicMetadataBulk(
  db: Db,
  ids: number[],
  fields: ComicMetadataUpdateFields,
): Promise<void> {
  for (const id of ids) {
    await updateComicMetadata(db, id, fields);
  }
}

/**
 * Resolve file paths + media type for the given ids — the targets the
 * cover-refresh worker needs to re-extract covers.
 * @param db The database handle.
 * @param ids Comic ids to look up.
 * @returns Rows for every existing id (missing ids are simply absent).
 */
export async function getComicFilesByIds(
  db: Db,
  ids: number[],
): Promise<Array<{ id: number; filePath: string; mediaType: 'comic' | 'book' }>> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all<{ id: number; file_path: string; media_type: string }>(
    `SELECT id, file_path, media_type FROM comics WHERE id IN (${placeholders})`,
    ids,
  );
  return rows.map((r) => ({ id: r.id, filePath: r.file_path, mediaType: r.media_type === 'book' ? 'book' : 'comic' }));
}

/**
 * Comics whose cover is missing or is just the baked-in placeholder (~600
 * bytes; real covers are far larger). The cover-refresh "all missing" target
 * set, bounded for one job.
 * @param db The database handle.
 * @param maxIds Maximum rows to return.
 */
export async function getCoverlessComicIds(
  db: Db,
  maxIds: number,
): Promise<Array<{ id: number; filePath: string; mediaType: 'comic' | 'book' }>> {
  const rows = await db.all<{ id: number; file_path: string; media_type: string }>(
    `SELECT c.id, c.file_path, c.media_type FROM comics c
     LEFT JOIN comic_covers cc ON cc.comic_id = c.id
     WHERE cc.comic_id IS NULL OR octet_length(cc.data) < 2048
     ORDER BY c.id LIMIT ?`,
    [maxIds],
  );
  return rows.map((r) => ({ id: r.id, filePath: r.file_path, mediaType: r.media_type === 'book' ? 'book' : 'comic' }));
}
