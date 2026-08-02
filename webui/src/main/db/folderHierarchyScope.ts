import type { QueryOptions } from '../../shared/types';
import {
  addSharedReadStatusFilter,
  addUserReadStatusFilter,
} from './comicQueryHelpers';
import type { SqlParam } from './types';

/**
 * @module
 * Folder Hierarchy Query Scoping
 *
 * Architecture overview for Junior Devs:
 * Listing the comics within a folder view requires assembling the right SQL JOINs
 * and WHERE conditions from a pile of optional filters (folder, media type, file
 * extension, search, read-status, favorites) — and doing so differently depending
 * on whether the request is per-user or shared. This module centralises that
 * assembly into one `buildHierarchyScope` function.
 *
 * The pattern to notice (shared with the other DB helpers): we accumulate SQL
 * fragments into `conditions`/`joins` arrays and their bound values into matching
 * `params` arrays, then return them joined. Keeping the JOIN params separate from
 * the condition params ensures the `?` placeholders bind in the correct order.
 */

/** Query options for a folder-hierarchy listing, including a favorites filter. */
export type FolderHierarchyOptions = QueryOptions & {
  favorites?: boolean;
};

/**
 * Build the JOINs, WHERE clause, and bound params for a folder listing.
 * Adds per-user progress/favorites JOINs only when `userId` is set, then
 *          appends conditions for each provided filter. Read-status filtering is
 *          delegated to the user-scoped or shared helper as appropriate. A
 *          favorites filter on a non-user query yields `1 = 0` (matches nothing,
 *          since favorites are per-user). The WHERE always includes a base clause
 *          so callers can safely append further `AND` conditions.
 * @param folderId Restrict to a folder's comics, or `null` for no folder scope.
 * @param options The active list filters (media type, search, read-status, etc.).
 * @param userId The requesting user's id, or `null` for a shared (non-user) query.
 * @returns The `joins` string, `where` clause, and ordered `params` array.
 */
export function buildHierarchyScope(
  folderId: number | null,
  options: FolderHierarchyOptions,
  userId: number | null,
): { joins: string; where: string; params: SqlParam[] } {
  const joins: string[] = [];
  const joinParams: SqlParam[] = [];
  const conditions: string[] = [];
  const condParams: SqlParam[] = [];

  if (userId != null) {
    joins.push('LEFT JOIN user_progress up ON up.comic_id = c.id AND up.user_id = ?');
    joins.push('LEFT JOIN user_favorites uf ON uf.comic_id = c.id AND uf.user_id = ?');
    joinParams.push(userId, userId);
  }

  if (folderId != null) {
    conditions.push('c.id IN (SELECT comic_id FROM folder_comics WHERE folder_id = ?)');
    condParams.push(folderId);
  }

  if (options.mediaType) {
    conditions.push('c.media_type = ?');
    condParams.push(options.mediaType);
  }
  if (options.fileExt) {
    conditions.push('LOWER(c.file_path) LIKE ?');
    condParams.push('%.' + options.fileExt.toLowerCase());
  }
  if (options.search) {
    const term = `%${options.search}%`;
    conditions.push('(c.title ILIKE ? OR c.file_path ILIKE ? OR c.series_name ILIKE ?)');
    condParams.push(term, term, term);
  }

  if (userId != null) addUserReadStatusFilter(conditions, options.readStatus);
  else addSharedReadStatusFilter(conditions, options.readStatus);

  if (options.favorites) {
    conditions.push(userId != null ? 'uf.comic_id IS NOT NULL' : '1 = 0');
  }

  return {
    joins: joins.join(' '),
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE 1=1',
    params: [...joinParams, ...condParams],
  };
}
