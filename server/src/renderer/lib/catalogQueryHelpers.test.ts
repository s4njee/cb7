import { describe, expect, it } from 'vitest';
import {
  CATALOG_PAGE_SIZE,
  catalogPageOffset,
  catalogSortOrder,
  comicQueryOptionsFromFilters,
  hierarchyQueryOptionsFromFilters,
  nextCatalogPageParam,
  normalizeComicQueryOptions,
} from './catalogQueryHelpers';

describe('catalogQueryHelpers', () => {
  it('uses a shared catalog page size and offset math', () => {
    expect(CATALOG_PAGE_SIZE).toBe(48);
    expect(catalogPageOffset(0)).toBe(0);
    expect(catalogPageOffset(3)).toBe(144);
    expect(catalogPageOffset(3, 10)).toBe(30);
  });

  it('computes the next infinite-query page param', () => {
    expect(nextCatalogPageParam({ totalCount: 100 }, [{}, {}])).toBe(2);
    expect(nextCatalogPageParam({ totalCount: 96 }, [{}, {}])).toBeUndefined();
    expect(nextCatalogPageParam({ totalCount: 25 }, [{}], 20)).toBe(1);
  });

  it('defaults date and reading sorts to descending', () => {
    expect(catalogSortOrder('dateAdded')).toBe('desc');
    expect(catalogSortOrder('lastRead')).toBe('desc');
    expect(catalogSortOrder('title')).toBe('asc');
  });

  it('normalizes comic query options for backend parameters', () => {
    expect(normalizeComicQueryOptions({
      sortBy: 'dateAdded',
      favoritesOnly: true,
    })).toEqual({
      sortBy: 'dateAdded',
      sortOrder: 'desc',
      favorites: true,
    });

    expect(normalizeComicQueryOptions({
      sortBy: 'dateAdded',
      sortOrder: 'asc',
      favoritesOnly: true,
    })).toEqual({
      sortBy: 'dateAdded',
      sortOrder: 'asc',
      favorites: true,
    });
  });

  it('builds comic query options from UI filters', () => {
    expect(comicQueryOptionsFromFilters({
      mediaType: 'book',
      sortBy: 'lastRead',
      sortOrder: 'asc',
      fileExt: 'epub',
      readStatus: 'completed',
      favoritesOnly: true,
    }, { tag: 'favorite', defaultSortBy: 'title' })).toEqual({
      tag: 'favorite',
      mediaType: 'book',
      sortBy: 'lastRead',
      sortOrder: 'asc',
      fileExt: 'epub',
      readStatus: 'completed',
      favorites: true,
    });
  });

  it('builds hierarchy query options from UI filters', () => {
    expect(hierarchyQueryOptionsFromFilters({
      mediaType: 'comic',
      search: 'Saga',
      fileExt: 'cbz',
      readStatus: 'unread',
      favoritesOnly: true,
    })).toEqual({
      mediaType: 'comic',
      search: 'Saga',
      fileExt: 'cbz',
      readStatus: 'unread',
      favorites: true,
    });
  });
});
