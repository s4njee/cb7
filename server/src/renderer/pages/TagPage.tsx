import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useUiStore } from '@/store/uiStore';
import * as api from '@/lib/api';
import LibraryGrid from '@/components/library/LibraryGrid';
import FilterStrips from '@/components/library/FilterStrips';
import SelectionBar from '@/components/library/SelectionBar';
import Breadcrumb from '@/components/library/Breadcrumb';
import { itemCountLabel } from '@/lib/utils';
import {
  CATALOG_PAGE_SIZE,
  catalogPageOffset,
  comicQueryOptionsFromFilters,
  nextCatalogPageParam,
} from '@/lib/catalogQueryHelpers';

export default function TagPage() {
  const { name } = useParams<{ name: string }>();
  const tagName = name ?? '';

  const {
    mediaType,
    sortBy,
    sortOrder,
    fileExt,
    readStatus,
    favoritesOnly,
    missingOnly,
  } = useUiStore();

  const filters = comicQueryOptionsFromFilters({
    mediaType,
    sortBy,
    sortOrder,
    fileExt,
    readStatus,
    favoritesOnly,
    missingOnly,
  }, { tag: tagName });

  // Infinite query for tag filtered list
  const infiniteQuery = useInfiniteQuery({
    queryKey: ['tag-comics', tagName, filters],
    queryFn: async ({ pageParam = 0 }) => {
      return api.fetchComics({
        ...filters,
        limit: CATALOG_PAGE_SIZE,
        offset: catalogPageOffset(pageParam),
      });
    },
    initialPageParam: 0,
    getNextPageParam: nextCatalogPageParam,
  });

  // Memoized so the grid's memoized cards keep stable props between re-renders.
  const infiniteData = infiniteQuery.data;
  const comics = useMemo(
    () => infiniteData?.pages.flatMap((page) => page.records) ?? [],
    [infiniteData],
  );

  return (
    <div className="flex flex-col min-h-full">
      {/* Header section */}
      <div className="p-4 border-b border-border bg-card/10 select-none flex items-center justify-between">
        <Breadcrumb />
        <span className="text-xs text-muted-foreground">
          {itemCountLabel(infiniteQuery.data?.pages[0]?.totalCount || 0)}
        </span>
      </div>

      {/* Filter controls */}
      <FilterStrips />

      {/* Infinite Grid */}
      <div className="flex-1">
        <LibraryGrid
          comics={comics}
          isLoading={infiniteQuery.isLoading}
          fetchNextPage={infiniteQuery.fetchNextPage}
          hasNextPage={infiniteQuery.hasNextPage}
          isFetchingNextPage={infiniteQuery.isFetchingNextPage}
          emptyMessage="No items found with this tag matching the current filters."
        />
      </div>

      <SelectionBar matchingScope={{ tag: tagName }} />
    </div>
  );
}
