/**
 * @module
 * Database Row Shapes and Reusable SQL Column Fragments
 *
 * Architecture overview for Junior Devs:
 * SQLite gives back plain objects with snake_case column names (e.g.
 * `file_path`). This file declares the TypeScript interfaces for those raw rows
 * (`ComicRow`, `LibraryRow`, ...) and a few reusable SQL string fragments so the
 * exact column lists aren't copy-pasted across `comics.ts`, `folders.ts`, etc.
 * Mapping these snake_case rows into the camelCase `MediaRecord` happens in the
 * domain modules and `webServer/mapping.ts`.
 */

/** A value that can be safely bound to a prepared statement parameter. */
export type SqlParam = string | number | bigint | Buffer | null;

export interface ComicRow {
  id: number;
  file_path: string;
  title: string;
  page_count: number;
  file_size: number;
  cover_thumbnail: Buffer | null;
  date_added: string;
  last_page: number | null;
  last_location: string | null;
  last_percent?: number | null;
  last_read: string | null;
  media_type: string;
}

export interface ComicListRow extends Omit<ComicRow, 'cover_thumbnail'> {
  has_thumbnail: number;
  thumbnail_version: number;
}

export interface CountRow {
  cnt: number;
}

export interface TagIdRow {
  id: number;
}

export interface TagNameRow {
  name: string;
}

export interface LibraryRow {
  id: number;
  name: string;
  comic_count: number;
  media_type: string;
}

/** Maps an API `sortBy` value to the SQL expression to ORDER BY. */
export const SORT_COLUMN_MAP: Record<string, string> = {
  title: 'lower(c.title)',
  dateAdded: 'c.date_added',
  fileSize: 'c.file_size',
  pageCount: 'c.page_count',
  lastRead: "COALESCE(c.last_read, '')",
};

/**
 * SELECT column list for a full comic record (includes the cover BLOB).
 *
 * Unaliased — use against `FROM comics` without a table alias. The
 * result maps to `ComicRow`. Prefer `COMIC_LIST_COLUMNS` for list queries to
 * avoid loading the cover blob for every row.
 */
export const COMIC_FULL_COLUMNS = `
  id, file_path, title, page_count, file_size, cover_thumbnail,
  date_added, last_page, last_location, last_percent, last_read, media_type
`;

/**
 * SELECT column list matching `ComicRow`'s shape but without fetching the
 * cover BLOB (`cover_thumbnail` comes back NULL).
 *
 * List-shaped API responses never send the blob, so skipping it avoids
 * shipping megabytes of BYTEA out of Postgres per request. Unaliased — use
 * against `FROM comics` without a table alias. Maps to `ComicRow`.
 */
export const COMIC_NO_BLOB_COLUMNS = `
  id, file_path, title, page_count, file_size, NULL as cover_thumbnail,
  date_added, last_page, last_location, last_percent, last_read, media_type
`;

/**
 * SELECT column list for a comic *list* row (no cover BLOB).
 *
 * Omits the heavy `cover_thumbnail` blob and instead exposes a
 * `has_thumbnail` flag plus a cheap `thumbnail_version` token (the blob length)
 * for cache-busting. Aliased to `c` — use against `FROM comics c`. Maps to
 * `ComicListRow`.
 */
export const COMIC_LIST_COLUMNS = `
  c.id, c.file_path, c.title, c.page_count, c.file_size,
  CASE WHEN c.cover_thumbnail IS NULL THEN 0 ELSE 1 END as has_thumbnail,
  COALESCE(length(c.cover_thumbnail), 0) as thumbnail_version,
  c.date_added, c.last_page, c.last_location, c.last_percent, c.last_read, c.media_type
`;

/**
 * Build the SELECT fragment that overlays per-user progress + favorite state.
 *
 * When `userId` is set, this pulls the user's progress and favorite
 * flag from the `up` (user_progress) and `uf` (user_favorites) LEFT JOINs —
 * which the caller must include in the query. When `userId` is null it emits
 * NULL/0 placeholders so the column shape stays identical. Maps to the `up_*`
 * and `is_fav` fields on `UserComicListRow`.
 *
 * @param userId The current user's id, or `null` for an anonymous/guest query.
 * @returns A SQL SELECT fragment to splice into a comic list query.
 */
export function userOverlaySelect(userId: number | null): string {
  return userId != null
    ? 'up.last_page as up_last_page, up.last_location as up_last_location, up.last_percent as up_last_percent, up.last_read as up_last_read, CASE WHEN uf.comic_id IS NULL THEN 0 ELSE 1 END as is_fav'
    : 'NULL as up_last_page, NULL as up_last_location, NULL as up_last_percent, NULL as up_last_read, 0 as is_fav';
}
