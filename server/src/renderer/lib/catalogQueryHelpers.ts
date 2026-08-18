import type {
  ComicQueryOptions,
  FileExtension,
  HierarchyQueryOptions,
  MediaType,
  ReadStatus,
  SortBy,
  SortOrder,
} from './api/types';

/**
 * @module
 * Catalog Query & Pagination Helpers (Renderer)
 *
 * Architecture overview for Junior Devs:
 * The catalog views (grids of comics/books and folder hierarchies) are backed by
 * paginated, filterable API queries. This module bridges the UI's filter state and
 * the API's query options: it computes page offsets, drives infinite-scroll's
 * "what's the next page?" logic, picks a sensible default sort order, and maps the
 * loose UI filter shape (where "" means "no filter") onto the precise query types
 * the API expects. Keeping it pure makes the data-fetching hooks thin and testable.
 */

/** Number of catalog items requested per page. */
export const CATALOG_PAGE_SIZE = 48;

/** The catalog filter UI state, where empty strings mean "no filter applied". */
export type CatalogFilterState = {
  mediaType?: MediaType | '';
  sortBy?: SortBy | '';
  sortOrder?: SortOrder;
  search?: string;
  fileExt?: FileExtension | string;
  readStatus?: ReadStatus | '';
  favoritesOnly?: boolean;
  /** When true, only include records whose file is missing from disk (P1-8). */
  missingOnly?: boolean;
};

/**
 * Compute the row offset for a given page index.
 * @param pageParam The zero-based page index.
 * @param pageSize Items per page (defaults to `CATALOG_PAGE_SIZE`).
 * @returns The offset into the result set.
 */
export function catalogPageOffset(pageParam: number, pageSize = CATALOG_PAGE_SIZE): number {
  return pageParam * pageSize;
}

/**
 * Determine the next page index for infinite scrolling.
 * Returns the next index while fewer items have been loaded than the
 *          reported total, or `undefined` to signal there are no more pages.
 * @param lastPage The most recently fetched page (provides `totalCount`).
 * @param allPages All pages fetched so far.
 * @param pageSize Items per page (defaults to `CATALOG_PAGE_SIZE`).
 * @returns The next page index, or `undefined` when the end is reached.
 */
export function nextCatalogPageParam(
  lastPage: { totalCount: number },
  allPages: readonly unknown[],
  pageSize = CATALOG_PAGE_SIZE,
): number | undefined {
  const loadedCount = allPages.length * pageSize;
  return loadedCount < lastPage.totalCount ? allPages.length : undefined;
}

/**
 * Pick the default sort direction for a sort field.
 * Recency-based sorts (`dateAdded`, `lastRead`) default to descending;
 *          all others default to ascending (A→Z, smallest first).
 * @param sortBy The active sort field, if any.
 * @returns `'desc'` for recency sorts, otherwise `'asc'`.
 */
export function catalogSortOrder(sortBy: SortBy | '' | undefined): SortOrder {
  return sortBy === 'dateAdded' || sortBy === 'lastRead' ? 'desc' : 'asc';
}

/**
 * Normalise comic query options before they are sent to the API.
 * Translates the UI-only `favoritesOnly` flag into the API's `favorites`
 *          field and fills in a default sort order when a sort field is set but no
 *          explicit order was given.
 * @param filters The raw query options (may include `favoritesOnly`).
 * @returns A cleaned `ComicQueryOptions` object.
 */
export function normalizeComicQueryOptions(filters: ComicQueryOptions = {}): ComicQueryOptions {
  const { favoritesOnly, ...rest } = filters;
  const query: ComicQueryOptions = { ...rest };

  if (favoritesOnly) {
    query.favorites = true;
  }
  if (query.sortBy && !query.sortOrder) {
    query.sortOrder = catalogSortOrder(query.sortBy);
  }

  return query;
}

/**
 * Build comic query options from the catalog filter UI state.
 * Converts empty-string "no filter" values to `undefined`, applies an
 *          optional default sort and tag, then normalises the result.
 * @param filters The catalog filter UI state.
 * @param extras Optional tag and a fallback sort field.
 * @returns Query options ready for the comics API.
 */
export function comicQueryOptionsFromFilters(
  filters: CatalogFilterState,
  extras: Pick<ComicQueryOptions, 'tag'> & { defaultSortBy?: SortBy } = {},
): ComicQueryOptions {
  return normalizeComicQueryOptions({
    tag: extras.tag,
    mediaType: filters.mediaType || undefined,
    sortBy: filters.sortBy || extras.defaultSortBy || undefined,
    sortOrder: filters.sortOrder || undefined,
    fileExt: filters.fileExt || undefined,
    readStatus: filters.readStatus || undefined,
    favoritesOnly: filters.favoritesOnly || undefined,
    missing: filters.missingOnly || undefined,
  });
}

/**
 * Build folder-hierarchy query options from the catalog filter UI state.
 * Maps the shared filter fields to the hierarchy query shape, converting
 *          empty strings to `undefined` and `favoritesOnly` to `favorites: true`.
 * @param filters The catalog filter UI state.
 * @returns Query options ready for the folder-hierarchy API.
 */
export function hierarchyQueryOptionsFromFilters(filters: CatalogFilterState): HierarchyQueryOptions {
  return {
    mediaType: filters.mediaType || undefined,
    search: filters.search || undefined,
    fileExt: filters.fileExt || undefined,
    readStatus: filters.readStatus || undefined,
    favorites: filters.favoritesOnly ? true : undefined,
  };
}
