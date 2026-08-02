import type { MediaRecord, QueryOptions } from '../../shared/types';
import type { SqlParam } from './types';
import { SORT_COLUMN_MAP } from './types';

/**
 * @file comicQueryHelpers.ts
 * Comic Query Building Helpers
 *
 * 
 * Architecture overview for Junior Devs:
 * The comics table can be searched and filtered many ways at once (full-text
 * search, paging, sorting, read-status). Rather than cram all of that into the
 * big query functions in `comics.ts`, the small, individually-testable pieces
 * live here.
 *
 * The pattern to notice: filter helpers take a shared `conditions` string array
 * and push SQL fragments into it. The caller later joins them with `AND` (see
 * `buildWhere`). This keeps every filter self-contained and easy to unit test.
 */

const DEFAULT_QUERY_LIMIT = 50;
const DEFAULT_QUERY_OFFSET = 0;

export interface UserComicOverlaySql {
  progressSelect: string;
  favoriteSelect: string;
  progressJoin: string;
  favoriteJoin: string;
  joinParams: SqlParam[];
}

export type ComicFilterOptions = QueryOptions & {
  libraryId?: number;
  folderId?: number;
};

/**
 * Build a Postgres `tsquery` string from free-form user input for prefix search.
 *
 * Strategy: tokenize on whitespace, strip everything but letters/digits/`_` from
 * each token, append `:*` for prefix matching, and AND the tokens together.
 * Because every token is reduced to alphanumerics, the result can never inject
 * `tsquery` operators, so it is safe to pass to `to_tsquery('english', ...)`.
 *
 * Example: `"naru-to vol 1"` becomes `naruto:* & vol:* & 1:*`.
 *
 * @param raw The user's raw search text.
 * @returns A `tsquery` expression, or `null` if the input has no usable tokens.
 */
export function buildFtsQuery(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(' & ');
}

/**
 * Coerce a free-form media-type string into a known value.
 * @param value Raw media-type string.
 * @returns `'book'` when the input is exactly `"book"`, otherwise `'comic'`.
 */
export function toMediaType(value: string): MediaRecord['mediaType'] {
  return value === 'book' ? 'book' : 'comic';
}

/**
 * Assemble a SQL WHERE clause from collected condition fragments.
 * @param conditions SQL fragments to AND together.
 * @returns A `WHERE ...` string, or an empty string when there are no conditions.
 */
export function buildWhere(conditions: string[]): string {
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
}

/**
 * Resolve paging options, applying defaults when unset.
 * @param options Query options that may include `limit` / `offset`.
 * @returns Effective `limit` and `offset` values.
 */
export function resolvePaging(options: QueryOptions): { limit: number; offset: number } {
  return {
    limit: options.limit ?? DEFAULT_QUERY_LIMIT,
    offset: options.offset ?? DEFAULT_QUERY_OFFSET,
  };
}

/**
 * Resolve the SQL sort column and direction from query options.
 *  `lastRead` only makes sense for per-user queries (it lives on the
 *          joined `up` table), so it is special-cased behind `userScoped`.
 *          Any other column is looked up in `SORT_COLUMN_MAP`, defaulting to title.
 * @param options Query options carrying `sortBy` / `sortOrder`.
 * @param userScoped Whether the query joins the user-progress (`up`) table.
 * @returns The resolved sort column expression and direction.
 */
export function resolveSort(options: QueryOptions, userScoped: boolean): { sortCol: string; sortDir: 'ASC' | 'DESC' } {
  const sortCol = options.sortBy === 'lastRead' && userScoped
    ? "COALESCE(up.last_read, '')"
    : (SORT_COLUMN_MAP[options.sortBy ?? 'title'] ?? SORT_COLUMN_MAP.title);
  const sortDir = options.sortOrder === 'desc' ? 'DESC' : 'ASC';
  return { sortCol, sortDir };
}

/**
 * Add a read-status filter for shared (non-user-scoped) queries.
 *  Uses the comic's own `last_page` / `last_read` columns. Pushes a
 *          condition for `unread`, `in-progress`, or `completed`; does nothing
 *          for any other value (e.g. "all").
 * @param conditions Shared conditions array to append to.
 * @param readStatus The requested read-status filter.
 */
export function addSharedReadStatusFilter(conditions: string[], readStatus: QueryOptions['readStatus']): void {
  if (readStatus === 'unread') {
    conditions.push('c.last_page IS NULL AND c.last_read IS NULL');
  } else if (readStatus === 'in-progress') {
    conditions.push('(c.last_page IS NOT NULL OR c.last_read IS NOT NULL) AND (c.last_page IS NULL OR c.last_page < c.page_count - 1)');
  } else if (readStatus === 'completed') {
    conditions.push('c.last_page = c.page_count - 1');
  }
}

export function buildComicFilters(
  options: ComicFilterOptions,
  opts: { includeSharedReadStatus: boolean },
): { conditions: string[]; params: SqlParam[] } {
  const conditions: string[] = [];
  const params: SqlParam[] = [];

  if (options.libraryId != null) {
    conditions.push('c.id IN (SELECT comic_id FROM library_comics WHERE library_id = ?)');
    params.push(options.libraryId);
  }

  if (options.folderId != null) {
    conditions.push('c.id IN (SELECT comic_id FROM folder_comics WHERE folder_id = ?)');
    params.push(options.folderId);
  }

  if (options.mediaType) {
    conditions.push('c.media_type = ?');
    params.push(options.mediaType);
  }

  if (options.search) {
    const tsquery = buildFtsQuery(options.search);
    if (tsquery) {
      conditions.push("c.search_vector @@ to_tsquery('english', ?)");
      params.push(tsquery);
    } else {
      conditions.push('1 = 0');
    }
  }

  if (options.tag) {
    conditions.push('c.id IN (SELECT ct.comic_id FROM comic_tags ct JOIN tags t ON ct.tag_id = t.id WHERE lower(t.name) = lower(?))');
    params.push(options.tag);
  }

  if (options.excludeFoldered) {
    conditions.push('c.id NOT IN (SELECT comic_id FROM folder_comics)');
  }

  if (options.fileExt) {
    conditions.push('LOWER(c.file_path) LIKE ?');
    params.push('%.' + options.fileExt.toLowerCase());
  }

  if (opts.includeSharedReadStatus) {
    addSharedReadStatusFilter(conditions, options.readStatus);
  }

  return { conditions, params };
}

/**
 * Add a read-status filter for per-user queries.
 *  Uses the joined user-progress (`up`) table instead of the comic's
 *          own columns, so each user sees their own progress. Pushes a condition
 *          for `unread`, `in-progress`, or `completed`; does nothing otherwise.
 * @param conditions Shared conditions array to append to.
 * @param readStatus The requested read-status filter.
 */
export function addUserReadStatusFilter(conditions: string[], readStatus: QueryOptions['readStatus']): void {
  if (readStatus === 'unread') {
    // "Started" means any progress signal, not just a page: EPUBs track position
    // via last_location (CFI) / last_percent and often sit at page 0, so they must
    // not be counted as unread once opened.
    conditions.push('(up.comic_id IS NULL OR (COALESCE(up.last_page, 0) = 0 AND up.last_location IS NULL AND COALESCE(up.last_percent, 0) = 0 AND up.completed = 0))');
  } else if (readStatus === 'in-progress') {
    // Mirror of the unread test: in-progress if started (page, CFI, or percent)
    // and not completed. The old `last_page > 0` test silently dropped every EPUB
    // whose page rounded to 0, hiding them from the Continue Reading shelf.
    conditions.push('up.comic_id IS NOT NULL AND up.completed = 0 AND (COALESCE(up.last_page, 0) > 0 OR up.last_location IS NOT NULL OR COALESCE(up.last_percent, 0) > 0)');
  } else if (readStatus === 'completed') {
    conditions.push('up.completed = 1');
  }
}

/**
 * Build SELECT/JOIN fragments for per-user progress and favorites.
 *  Anonymous queries still select placeholder columns so row mapping can
 *          stay uniform. User-scoped queries add two LEFT JOINs and bind the
 *          user id once for progress and once for favorites.
 * @param userId Current user id, or null for shared/anonymous state.
 * @returns SQL fragments and bound parameters for the overlay joins.
 */
export function buildUserComicOverlaySql(userId: number | null): UserComicOverlaySql {
  if (userId == null) {
    return {
      progressSelect: 'NULL as up_last_page, NULL as up_last_location, NULL as up_last_percent, NULL as up_last_read, 0 as up_completed',
      favoriteSelect: '0 as is_fav',
      progressJoin: '',
      favoriteJoin: '',
      joinParams: [],
    };
  }

  return {
    progressSelect: 'up.last_page as up_last_page, up.last_location as up_last_location, up.last_percent as up_last_percent, up.last_read as up_last_read, up.completed as up_completed',
    favoriteSelect: 'CASE WHEN uf.comic_id IS NULL THEN 0 ELSE 1 END as is_fav',
    progressJoin: 'LEFT JOIN user_progress up ON up.comic_id = c.id AND up.user_id = ?',
    favoriteJoin: 'LEFT JOIN user_favorites uf ON uf.comic_id = c.id AND uf.user_id = ?',
    joinParams: [userId, userId],
  };
}
