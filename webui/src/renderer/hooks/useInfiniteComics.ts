import { useInfiniteQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import {
  CATALOG_PAGE_SIZE,
  catalogPageOffset,
  nextCatalogPageParam,
  normalizeComicQueryOptions,
} from '@/lib/catalogQueryHelpers';

export const PAGE_SIZE = CATALOG_PAGE_SIZE;

export function useInfiniteComics(filters: api.ComicQueryOptions = {}) {
  const queryParams = normalizeComicQueryOptions(filters);

  return useInfiniteQuery({
    queryKey: ['comics', queryParams],
    queryFn: async ({ pageParam = 0 }) => {
      return api.fetchComics({
        ...queryParams,
        limit: PAGE_SIZE,
        offset: catalogPageOffset(pageParam),
      });
    },
    initialPageParam: 0,
    getNextPageParam: nextCatalogPageParam,
  });
}
