import * as path from 'node:path';
import type { QueryOptions } from '../../../shared/types';
import { parseQueryOptions } from '../middleware';

/**
 * @file folderRouteHelpers.ts
 * Folder HTTP Route Helpers
 *
 * 
 * Architecture overview for Junior Devs:
 * These pure helpers back the folder API routes: parsing list query parameters,
 * building thumbnail URLs the client can request, and a small path utility used
 * when summarising where a folder's files live. Keeping them out of the route
 * handlers makes both the handlers and these rules easy to test in isolation.
 */

/** Query options accepted by folder list routes, plus filters and a folder scope. */
export type FolderRouteOptions = QueryOptions & {
  readStatus?: 'unread' | 'in-progress' | 'completed';
  favorites?: boolean;
  folderId?: number;
};

/**
 * Parse and normalise folder-list query parameters from a request.
 *  Optionally scopes results to a folder, applies a default page limit,
 *          and only accepts known read-status and favorites values.
 * @param query The raw request query object.
 * @param folderId Optional folder to scope the listing to.
 * @returns Normalised folder route options.
 */
export function parseFolderRouteOptions(query: Record<string, string>, folderId?: number): FolderRouteOptions {
  const opts = parseQueryOptions(query) as FolderRouteOptions;
  if (folderId != null) opts.folderId = folderId;
  if (!opts.limit) opts.limit = 50;
  if (query.readStatus === 'unread' || query.readStatus === 'in-progress' || query.readStatus === 'completed') {
    opts.readStatus = query.readStatus;
  }
  if (query.favorites === 'true') opts.favorites = true;
  return opts;
}

/**
 * Build the API URL for a comic's thumbnail.
 * @param comicId The comic id, or `null`.
 * @returns The thumbnail URL, or `null` when there is no comic.
 */
export function comicThumbnailUrl(comicId: number | null): string | null {
  return comicId ? `/api/comics/${comicId}/thumbnail` : null;
}

/**
 * Build the API URL for a folder's thumbnail.
 * @param folderId The folder id.
 * @param hasThumbnail Whether the folder actually has a thumbnail.
 * @returns The thumbnail URL, or `null` when none exists.
 */
export function folderThumbnailUrl(folderId: number, hasThumbnail: boolean): string | null {
  return hasThumbnail ? `/api/folders/${folderId}/thumbnail` : null;
}

/**
 * Attach a `thumbnailUrl` to a group based on its cover comic.
 *  T A group object carrying a `coverComicId`.
 * @param group The group to enrich.
 * @returns The same group with an added `thumbnailUrl` field.
 */
export function withGroupThumbnail<T extends { coverComicId: number | null }>(group: T): T & { thumbnailUrl: string | null } {
  return { ...group, thumbnailUrl: comicThumbnailUrl(group.coverComicId) };
}

/**
 * Find the deepest directory that is a common ancestor of all inputs.
 *  Walks each directory up toward the root until it is a prefix of the
 *          running common path. Returns `null` if the paths share no ancestor.
 * @param dirs The directories to compare.
 * @returns The common ancestor directory, or `null`.
 */
export function findCommonDir(dirs: string[]): string | null {
  if (dirs.length === 0) return null;
  let common = dirs[0];
  for (const dir of dirs.slice(1)) {
    while (dir !== common && !dir.startsWith(common + path.sep)) {
      const parent = path.dirname(common);
      if (parent === common) return null;
      common = parent;
    }
  }
  return common;
}

/**
 * Build the key used to store a folder's last-scan timestamp in metadata.
 * @param folderId The folder id.
 * @returns The metadata key string.
 */
export function folderScanMetaKey(folderId: number): string {
  return `folder_scan_ts:${folderId}`;
}
