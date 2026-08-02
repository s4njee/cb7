import type { MediaRecord } from '../../shared/types';
import type { SqlParam, ComicRow, ComicListRow, CountRow } from './types';
import { NOW_TEXT_SQL, type Db, type PgDatabase } from './pg';
import {
  addUserReadStatusFilter,
  buildComicFilters,
  buildUserComicOverlaySql,
  buildWhere,
  resolvePaging,
  resolveSort,
  toMediaType,
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

/**
 * @module
 * Comics Database Operations
 *
 * Architecture overview for Junior Devs:
 * This module handles all SQL queries related to the `comics` table, including inserts,
 * updates, and complex search/filter queries (like `queryComicsForUser`).
 *
 * Query Building Strategy:
 * Because a user can filter by library, folder, search term, tags, and read status simultaneously,
 * we use dynamic query building (e.g., `buildComicFilters`). We push conditions into a `conditions`
 * array and arguments into a `params` array, then join them with `AND`. This prevents SQL injection
 * while keeping the complex query logic readable.
 */

type UserComicQueryOptions = ComicFilterOptions & {
  favorites?: boolean;
};

type UserComicListRow = ComicListRow & {
  up_last_page: number | null;
  up_last_location: string | null;
  up_last_percent: number | null;
  up_last_read: string | null;
  up_completed: number;
  is_fav: number;
};

type ComicTagRow = {
  comic_id: number;
  name: string;
};

const TAG_LOOKUP_CHUNK_SIZE = 500;

async function getTagsByComicId(db: Db, comicIds: number[]): Promise<Map<number, string[]>> {
  const ids = Array.from(new Set(comicIds));
  if (!ids.length) return new Map();

  const tagsById = new Map<number, string[]>();
  for (let i = 0; i < ids.length; i += TAG_LOOKUP_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + TAG_LOOKUP_CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.all<ComicTagRow>(
      `SELECT ct.comic_id, t.name
       FROM comic_tags ct
       JOIN tags t ON t.id = ct.tag_id
       WHERE ct.comic_id IN (${placeholders})
       ORDER BY lower(t.name)`,
      chunk,
    );

    for (const row of rows) {
      const tags = tagsById.get(row.comic_id);
      if (tags) tags.push(row.name);
      else tagsById.set(row.comic_id, [row.name]);
    }
  }
  return tagsById;
}

async function withBatchedTags<T extends MediaRecord>(db: Db, records: T[]): Promise<T[]> {
  const tagsById = await getTagsByComicId(db, records.map((record) => record.id));
  for (const record of records) {
    record.tags = tagsById.get(record.id) ?? [];
  }
  return records;
}

function rowToRecordBase(row: ComicRow, tags: string[]): MediaRecord {
  return {
    id: row.id,
    filePath: row.file_path,
    title: row.title,
    pageCount: row.page_count,
    fileSize: row.file_size,
    coverThumbnail: row.cover_thumbnail,
    dateAdded: row.date_added,
    tags,
    lastPage: row.last_page ?? null,
    lastLocation: row.last_location ?? null,
    lastPercent: row.last_percent ?? null,
    lastRead: row.last_read ?? null,
    mediaType: toMediaType(row.media_type),
  };
}

export async function rowToRecord(db: Db, row: ComicRow): Promise<MediaRecord> {
  const tags = (await getTagsByComicId(db, [row.id])).get(row.id) ?? [];
  return rowToRecordBase(row, tags);
}

export async function rowsToRecords(db: Db, rows: ComicRow[]): Promise<MediaRecord[]> {
  return withBatchedTags(db, rows.map((row) => rowToRecordBase(row, [])));
}

export function rowToListRecord(row: ComicListRow): MediaRecord {
  return {
    id: row.id,
    filePath: row.file_path,
    title: row.title,
    pageCount: row.page_count,
    fileSize: row.file_size,
    coverThumbnail: null,
    hasThumbnail: row.has_thumbnail === 1,
    thumbnailVersion: row.thumbnail_version,
    dateAdded: row.date_added,
    tags: [],
    lastPage: row.last_page ?? null,
    lastLocation: row.last_location ?? null,
    lastPercent: row.last_percent ?? null,
    lastRead: row.last_read ?? null,
    mediaType: toMediaType(row.media_type),
  };
}

/**
 * Fast-path insert for the bulk ingest pipeline. Skips the post-insert
 * SELECT round-trip and tag handling. Caller (flushBatch) runs this
 * inside a single transaction across many rows.
 */
export async function addComicFast(
  db: Db,
  record: {
    filePath: string;
    title: string;
    pageCount: number;
    fileSize: number;
    coverThumbnail: Buffer;
    mediaType: 'comic' | 'book';
  },
): Promise<number> {
  await db.run('DELETE FROM dismissed_paths WHERE file_path = ?', [record.filePath]);
  const row = (await db.get<{ id: number }>(
    `INSERT INTO comics (file_path, title, page_count, file_size, cover_thumbnail, last_page, last_location, last_read, media_type)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?) RETURNING id`,
    [record.filePath, record.title, record.pageCount, record.fileSize, record.coverThumbnail, record.mediaType],
  ))!;
  return row.id;
}

export async function addComic(db: Db, record: Omit<MediaRecord, 'id' | 'dateAdded'>): Promise<MediaRecord> {
  await db.run('DELETE FROM dismissed_paths WHERE file_path = ?', [record.filePath]);
  const inserted = (await db.get<{ id: number }>(
    `INSERT INTO comics (file_path, title, page_count, file_size, cover_thumbnail, last_page, last_location, last_read, media_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      record.filePath,
      record.title,
      record.pageCount,
      record.fileSize,
      record.coverThumbnail,
      record.lastPage,
      record.lastLocation,
      record.lastRead,
      record.mediaType ?? 'comic',
    ],
  ))!;
  const id = inserted.id;

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
  const rows = await db.all<{ file_path: string }>(`SELECT file_path FROM comics WHERE id IN (${placeholders})`, ids);
  await db.tx(async (tx) => {
    for (const row of rows) {
      await tx.run('INSERT INTO dismissed_paths (file_path) VALUES (?) ON CONFLICT DO NOTHING', [row.file_path]);
    }
    await tx.run(`DELETE FROM comics WHERE id IN (${placeholders})`, ids);
  });
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
 *
 * For hot routes (page/file streaming, existence checks) that only need the
 * file path and basic metadata, `getComic` wastes work: it pulls the BYTEA
 * cover out of Postgres and runs a second query for tags, neither of which
 * the caller uses. The returned record has `coverThumbnail: null`, `tags: []`.
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

export async function updateCoverThumbnailByPath(db: Db, filePath: string, coverThumbnail: Buffer | null): Promise<void> {
  await db.run('UPDATE comics SET cover_thumbnail = ? WHERE file_path = ?', [coverThumbnail, filePath]);
}

export async function updatePageCountByPath(db: Db, filePath: string, pageCount: number): Promise<void> {
  await db.run('UPDATE comics SET page_count = ? WHERE file_path = ?', [pageCount, filePath]);
}

export async function getComicByPath(db: Db, filePath: string): Promise<MediaRecord | null> {
  const row = await db.get<ComicRow>(`SELECT ${COMIC_FULL_COLUMNS} FROM comics WHERE file_path = ?`, [filePath]);
  if (!row) return null;
  return rowToRecord(db, row);
}

export async function getCoverThumbnail(db: Db, comicId: number): Promise<Buffer | null> {
  const row = await db.get<{ cover_thumbnail: Buffer | null }>('SELECT cover_thumbnail FROM comics WHERE id = ?', [comicId]);
  return row?.cover_thumbnail ?? null;
}

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
 * Shared body for the recently-read / continue-reading lists. They differ only
 * by the `completed = 0` predicate, plus an optional media_type filter.
 */
async function readingList(
  db: Db,
  limit: number,
  mediaType: 'comic' | 'book' | undefined,
  onlyIncomplete: boolean,
): Promise<MediaRecord[]> {
  const conditions = ['last_read IS NOT NULL'];
  const params: SqlParam[] = [];
  if (onlyIncomplete) conditions.push('completed = 0');
  if (mediaType) {
    conditions.push('media_type = ?');
    params.push(mediaType);
  }
  const rows = await db.all<ComicRow>(
    `SELECT ${COMIC_NO_BLOB_COLUMNS} FROM comics
     WHERE ${conditions.join(' AND ')}
     ORDER BY last_read DESC LIMIT ?`,
    [...params, limit],
  );
  return rowsToRecords(db, rows);
}

export function getRecentlyRead(
  db: Db,
  limit: number = 10,
  mediaType?: 'comic' | 'book',
): Promise<MediaRecord[]> {
  return readingList(db, limit, mediaType, false);
}

export function getContinueReading(
  db: Db,
  limit: number = 10,
  mediaType?: 'comic' | 'book',
): Promise<MediaRecord[]> {
  return readingList(db, limit, mediaType, true);
}

export async function setComicSeries(
  db: Db,
  comicId: number,
  seriesName: string | null,
  volumeNumber: number | null,
  chapterNumber: number | null,
): Promise<void> {
  await db.run('UPDATE comics SET series_name = ?, volume_number = ?, chapter_number = ? WHERE id = ?', [seriesName, volumeNumber, chapterNumber, comicId]);
}

export async function getAllSeries(db: Db): Promise<{ name: string; count: number; coverComicId: number | null }[]> {
  const rows = await db.all<{ name: string; count: number; cover_id: number | null }>(
    `SELECT series_name as name, COUNT(*) as count,
      (SELECT c2.id FROM comics c2 WHERE c2.series_name = c.series_name ORDER BY COALESCE(c2.volume_number, 999999), COALESCE(c2.chapter_number, 999999), c2.id LIMIT 1) as cover_id
     FROM comics c
     WHERE series_name IS NOT NULL AND series_name != ''
     GROUP BY series_name
     ORDER BY lower(series_name)`,
  );
  return rows.map((r) => ({ name: r.name, count: r.count, coverComicId: r.cover_id }));
}

export async function getSeriesComics(db: Db, name: string): Promise<MediaRecord[]> {
  const rows = await db.all<ComicRow>(
    `SELECT ${COMIC_NO_BLOB_COLUMNS}
     FROM comics
     WHERE lower(series_name) = lower(?)
     ORDER BY COALESCE(volume_number, 999999), COALESCE(chapter_number, 999999), lower(title)`,
    [name],
  );
  return rowsToRecords(db, rows);
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
            external_id, external_source, series_name, volume_number, chapter_number
     FROM comics
     WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return rowToComicMetadata(row);
}

export async function queryComicsForUser(
  db: Db,
  userId: number | null,
  options: UserComicQueryOptions,
): Promise<{ records: (MediaRecord & { favorited?: boolean })[]; totalCount: number }> {
  const { conditions, params } = buildComicFilters(options, { includeSharedReadStatus: false });
  const userOverlay = buildUserComicOverlaySql(userId);

  if (options.readStatus && userId != null) {
    addUserReadStatusFilter(conditions, options.readStatus);
  }

  if (options.favorites && userId != null) {
    conditions.push('uf.comic_id IS NOT NULL');
  }

  const where = buildWhere(conditions);
  const { sortCol, sortDir } = resolveSort(options, userId != null);
  const { limit, offset } = resolvePaging(options);

  const allParams = [...userOverlay.joinParams, ...params];

  // The up/uf LEFT JOINs are 1:1 (both PK'd on user_id, comic_id) so they never
  // change the row count. Only include them in COUNT(*) when the WHERE actually
  // references them (read-status / favorites filters) — otherwise the count scan
  // does two needless index lookups per comic.
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

  const baseRecords = await withBatchedTags(db, rows.map(rowToListRecord));
  const records = baseRecords.map((base, index) => {
    const row = rows[index];
    return {
      ...base,
      lastPage: userId != null ? row.up_last_page : base.lastPage,
      lastLocation: userId != null ? row.up_last_location : base.lastLocation,
      lastPercent: userId != null ? row.up_last_percent : base.lastPercent,
      lastRead: userId != null ? row.up_last_read : base.lastRead,
      favorited: Boolean(row.is_fav),
    };
  });

  return { records, totalCount };
}
