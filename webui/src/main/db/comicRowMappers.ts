import type { MediaRecord } from '../../shared/types';
import type { ComicRow, ComicListRow } from './types';
import type { Db } from './pg';
import { toMediaType } from './comicQueryHelpers';

type ComicTagRow = {
  comic_id: number;
  name: string;
};

const TAG_LOOKUP_CHUNK_SIZE = 500;

export async function getTagsByComicId(db: Db, comicIds: number[]): Promise<Map<number, string[]>> {
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

export async function withBatchedTags<T extends MediaRecord>(db: Db, records: T[]): Promise<T[]> {
  const tagsById = await getTagsByComicId(db, records.map((record) => record.id));
  for (const record of records) {
    record.tags = tagsById.get(record.id) ?? [];
  }
  return records;
}

export function rowToRecordBase(row: ComicRow, tags: string[]): MediaRecord {
  return {
    id: row.id,
    filePath: row.file_path,
    title: row.title,
    pageCount: row.page_count,
    fileSize: row.file_size,
    coverThumbnail: row.cover_thumbnail,
    dateAdded: row.date_added,
    tags,
    lastPage: row.last_page,
    lastLocation: row.last_location,
    lastPercent: row.last_percent ?? null,
    lastRead: row.last_read,
    mediaType: toMediaType(row.media_type),
    missingAt: row.missing_at ?? null,
  };
}

export async function rowToRecord(db: Db, row: ComicRow): Promise<MediaRecord> {
  const tagsById = await getTagsByComicId(db, [row.id]);
  return rowToRecordBase(row, tagsById.get(row.id) ?? []);
}

export async function rowsToRecords(db: Db, rows: ComicRow[]): Promise<MediaRecord[]> {
  const tagsById = await getTagsByComicId(db, rows.map((row) => row.id));
  return rows.map((row) => rowToRecordBase(row, tagsById.get(row.id) ?? []));
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
    lastPage: row.last_page,
    lastLocation: row.last_location,
    lastPercent: row.last_percent ?? null,
    lastRead: row.last_read,
    mediaType: toMediaType(row.media_type),
    missingAt: row.missing_at ?? null,
  };
}
