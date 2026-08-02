/**
 * @module
 * Library Route Input-Shaping Helpers
 *
 * Architecture overview for Junior Devs:
 * The library routes create libraries and list the items inside them. Both take
 * untrusted input — a media type when creating, and a bag of URL query strings
 * when listing (read status, favourites, paging). This module holds the pure
 * functions that turn that raw input into the typed options the database layer
 * expects, so the route handlers stay thin and the rules stay unit-testable.
 *
 * `buildLibraryComicQueryOptions` is the main one: it starts from the shared
 * base query options, scopes them to a library, applies a default page size, and
 * only copies through `readStatus`/`favorites` when they are actually valid
 * (guarded by the `isReadStatus` type guard). `mediaTypeForNewLibrary` defaults
 * anything that isn't explicitly `'book'` to `'comic'`.
 */
import type { QueryOptions } from '../../../shared/types';

/** The kind of media a library holds. */
export type LibraryMediaType = 'comic' | 'book';

/** Query options for listing a single library's items. */
export type LibraryComicQueryOptions = QueryOptions & {
  readStatus?: 'unread' | 'in-progress' | 'completed';
  favorites?: boolean;
  libraryId: number;
};

/**
 * Resolve the media type for a newly created library.
 * @param value The raw media-type value from the request.
 * @returns `'book'` only when explicitly requested; otherwise `'comic'`.
 */
export function mediaTypeForNewLibrary(value: unknown): LibraryMediaType {
  return value === 'book' ? 'book' : 'comic';
}

/**
 * Build typed list-query options for a library from raw URL query params.
 * Scopes the base options to `libraryId`, applies a default `limit` of
 *          50, and copies through `readStatus` (when valid) and `favorites`
 *          (when the string is `'true'`).
 * @param baseOptions The shared, already-parsed base query options.
 * @param query The raw URL query string map.
 * @param libraryId The id of the library being listed.
 * @returns The typed query options for the database layer.
 */
export function buildLibraryComicQueryOptions(
  baseOptions: QueryOptions,
  query: Record<string, string>,
  libraryId: number
): LibraryComicQueryOptions {
  const opts = {
    ...baseOptions,
    libraryId,
  } as LibraryComicQueryOptions;

  if (!opts.limit) {
    opts.limit = 50;
  }
  if (isReadStatus(query.readStatus)) {
    opts.readStatus = query.readStatus;
  }
  if (query.favorites === 'true') {
    opts.favorites = true;
  }

  return opts;
}

/**
 * Type guard for a valid read-status query value.
 * @param value The raw query value, if present.
 * @returns `true` when `value` is one of the known read statuses.
 */
function isReadStatus(value: string | undefined): value is 'unread' | 'in-progress' | 'completed' {
  return value === 'unread' || value === 'in-progress' || value === 'completed';
}
