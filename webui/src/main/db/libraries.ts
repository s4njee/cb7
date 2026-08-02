import type { SqlParam, ComicListRow, CountRow, LibraryRow } from './types';
import { SORT_COLUMN_MAP } from './types';
import { rowToListRecord } from './comics';
import type { Db, PgDatabase } from './pg';
import type { QueryOptions, QueryResult } from '../../shared/types';

/**
 * @module
 * Database Operations for Libraries and Their Membership
 *
 * Architecture overview for Junior Devs:
 * A "library" is a named, media-typed bucket (comic vs book). This module owns
 * the `libraries`, `library_comics`, and `library_folders` tables: creating and
 * renaming libraries, adding/removing comics and folders, and running the paged,
 * filtered query that lists a library's contents. As with the other
 * `src/main/db/` modules, these are free functions that take the async DB
 * handle; `libraryDatabase.ts` exposes them to the app.
 */

export async function createLibrary(
  db: Db,
  name: string,
  mediaType: 'comic' | 'book' = 'comic',
): Promise<{ id: number; name: string; mediaType: 'comic' | 'book' }> {
  const row = (await db.get<{ id: number }>('INSERT INTO libraries (name, media_type) VALUES (?, ?) RETURNING id', [name, mediaType]))!;
  return { id: row.id, name, mediaType };
}

export async function renameLibrary(db: Db, id: number, newName: string): Promise<void> {
  await db.run('UPDATE libraries SET name = ? WHERE id = ?', [newName, id]);
}

export async function deleteLibrary(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM libraries WHERE id = ?', [id]);
}

export async function getAllLibraries(
  db: Db,
  mediaType?: 'comic' | 'book',
): Promise<{ id: number; name: string; comicCount: number; mediaType: 'comic' | 'book' }[]> {
  const where = mediaType ? 'WHERE l.media_type = ?' : '';
  const params = mediaType ? [mediaType] : [];
  const rows = await db.all<LibraryRow>(
    `SELECT l.id, l.name, l.media_type, COUNT(lc.comic_id) as comic_count
     FROM libraries l
     LEFT JOIN library_comics lc ON l.id = lc.library_id
     ${where}
     GROUP BY l.id
     ORDER BY lower(l.name)`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    comicCount: r.comic_count,
    mediaType: (r.media_type === 'book' ? 'book' : 'comic') as 'comic' | 'book',
  }));
}

export async function addComicsToLibrary(db: PgDatabase, libraryId: number, comicIds: number[]): Promise<void> {
  await db.tx(async (tx) => {
    for (const id of comicIds) {
      await tx.run('DELETE FROM library_comics WHERE comic_id = ?', [id]);
      await tx.run('INSERT INTO library_comics (library_id, comic_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [libraryId, id]);
    }
  });
}

export async function removeComicsFromLibrary(db: PgDatabase, libraryId: number, comicIds: number[]): Promise<void> {
  await db.tx(async (tx) => {
    for (const id of comicIds) {
      await tx.run('DELETE FROM library_comics WHERE library_id = ? AND comic_id = ?', [libraryId, id]);
    }
  });
}

export async function addFoldersToLibrary(db: PgDatabase, libraryId: number, folderIds: number[]): Promise<void> {
  await db.tx(async (tx) => {
    for (const folderId of folderIds) {
      const rows = await tx.all<{ comic_id: number }>('SELECT comic_id FROM folder_comics WHERE folder_id = ?', [folderId]);
      for (const row of rows) {
        await tx.run('DELETE FROM library_comics WHERE comic_id = ?', [row.comic_id]);
        await tx.run('INSERT INTO library_comics (library_id, comic_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [libraryId, row.comic_id]);
      }
    }
  });
}

export async function queryComicsByLibrary(
  db: Db,
  libraryId: number,
  options: QueryOptions = {},
): Promise<QueryResult> {
  const conditions: string[] = ['c.id IN (SELECT comic_id FROM library_comics WHERE library_id = ?)'];
  const params: SqlParam[] = [libraryId];

  if (options.mediaType) {
    conditions.push('c.media_type = ?');
    params.push(options.mediaType);
  }

  if (options.search) {
    conditions.push('(c.title ILIKE ? OR c.file_path ILIKE ?)');
    const term = `%${options.search}%`;
    params.push(term, term);
  }

  if (options.excludeFoldered) {
    conditions.push('c.id NOT IN (SELECT comic_id FROM folder_comics)');
  }

  if (options.fileExt) {
    conditions.push('LOWER(c.file_path) LIKE ?');
    params.push('%.' + options.fileExt.toLowerCase());
  }

  if (options.readStatus === 'unread') {
    conditions.push('c.last_page IS NULL AND c.last_read IS NULL');
  } else if (options.readStatus === 'in-progress') {
    conditions.push('(c.last_page IS NOT NULL OR c.last_read IS NOT NULL) AND (c.last_page IS NULL OR c.last_page < c.page_count - 1)');
  } else if (options.readStatus === 'completed') {
    conditions.push('c.last_page = c.page_count - 1');
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const sortCol = SORT_COLUMN_MAP[options.sortBy ?? 'title'] ?? SORT_COLUMN_MAP.title;
  const sortDir = options.sortOrder === 'desc' ? 'DESC' : 'ASC';
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const countRow = await db.get<CountRow>(`SELECT COUNT(*) as cnt FROM comics c ${where}`, params);
  const totalCount = countRow?.cnt ?? 0;

  const rows = await db.all<ComicListRow>(
    `SELECT c.id, c.file_path, c.title, c.page_count, c.file_size,
            CASE WHEN c.cover_thumbnail IS NULL THEN 0 ELSE 1 END as has_thumbnail,
            COALESCE(length(c.cover_thumbnail), 0) as thumbnail_version,
            c.date_added, c.last_page, c.last_location, c.last_read, c.media_type
     FROM comics c ${where}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return {
    records: rows.map(rowToListRecord),
    totalCount,
  };
}
