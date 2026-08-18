import React from 'react';
import { useParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import LibraryGrid from '@/components/library/LibraryGrid';
import { itemCountLabel } from '@/lib/utils';
import HierarchyPageFrame from '../HierarchyPageFrame';
import {
  CATALOG_PAGE_SIZE,
  catalogPageOffset,
  nextCatalogPageParam,
} from '@/lib/catalogQueryHelpers';
import {
  firstPageTotalCount,
  recordsFromPages,
} from '../hierarchyPageHelpers';
import { useFolderRouteOptions } from './useFolderRouteOptions';

/**
 * Folder Chapter Page — renders flat comics inside a chapter.
 */
export function FolderChapterPage() {
  const { id, k, v, c } = useParams<{ id: string; k: string; v: string; c: string }>();
  const folderId = Number(id);
  const seriesKey = k || '';
  const volumeKey = v || '';
  const chapterKey = c || '';
  const { queryOpts } = useFolderRouteOptions();

  const infiniteQuery = useInfiniteQuery({
    queryKey: ['folder-chapter-comics', folderId, seriesKey, volumeKey, chapterKey, queryOpts],
    queryFn: async ({ pageParam = 0 }) => {
      return api.fetchFolderChapterComics(folderId, seriesKey, volumeKey, chapterKey, {
        ...queryOpts,
        limit: CATALOG_PAGE_SIZE,
        offset: catalogPageOffset(pageParam),
      });
    },
    initialPageParam: 0,
    getNextPageParam: nextCatalogPageParam,
    enabled: !isNaN(folderId) && !!seriesKey && !!volumeKey && !!chapterKey,
  });

  const comics = recordsFromPages(infiniteQuery.data);

  return (
    <HierarchyPageFrame countLabel={itemCountLabel(firstPageTotalCount(infiniteQuery.data))}>
      <LibraryGrid
        comics={comics}
        isLoading={infiniteQuery.isLoading}
        fetchNextPage={infiniteQuery.fetchNextPage}
        hasNextPage={infiniteQuery.hasNextPage}
        isFetchingNextPage={infiniteQuery.isFetchingNextPage}
        emptyMessage="No issues found in this chapter matching the current filters."
      />
    </HierarchyPageFrame>
  );
}
