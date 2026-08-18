import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
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
  folderChapterHref,
  recordsFromPages,
  shouldShowChapterGroups,
} from '../hierarchyPageHelpers';
import { useFolderRouteOptions } from './useFolderRouteOptions';

/**
 * Folder Volume Page — renders chapters list OR flat comics if shouldShowChapters is false.
 */
export function FolderVolumePage() {
  const { id, k, v } = useParams<{ id: string; k: string; v: string }>();
  const folderId = Number(id);
  const seriesKey = k || '';
  const volumeKey = v || '';
  const { groupFilters, queryOpts } = useFolderRouteOptions();

  // Fetch chapters
  const { data: chaptersResponse, isLoading: isLoadingChapters } = useQuery({
    queryKey: ['folder-chapters', folderId, seriesKey, volumeKey, groupFilters],
    queryFn: () => api.fetchFolderVolumeChapters(folderId, seriesKey, volumeKey, groupFilters),
    enabled: !isNaN(folderId) && !!seriesKey && !!volumeKey,
  });

  const chapterGroups = chaptersResponse?.groups || [];
  const shouldShowChapters = shouldShowChapterGroups(chapterGroups);

  // Fetch flat comics if we skip chapters
  const infiniteQuery = useInfiniteQuery({
    queryKey: ['folder-volume-comics-flat', folderId, seriesKey, volumeKey, queryOpts],
    queryFn: async ({ pageParam = 0 }) => {
      return api.fetchFolderVolumeComics(folderId, seriesKey, volumeKey, {
        ...queryOpts,
        limit: CATALOG_PAGE_SIZE,
        offset: catalogPageOffset(pageParam),
      });
    },
    initialPageParam: 0,
    getNextPageParam: nextCatalogPageParam,
    enabled: !isNaN(folderId) && !!seriesKey && !!volumeKey && !shouldShowChapters,
  });

  const flatComics = recordsFromPages(infiniteQuery.data);

  const chaptersWithHref = chapterGroups.map((g) => ({
    ...g,
    href: folderChapterHref(folderId, seriesKey, volumeKey, g),
  }));

  return (
    <HierarchyPageFrame
      countLabel={shouldShowChapters
        ? itemCountLabel(chapterGroups.length)
        : itemCountLabel(firstPageTotalCount(infiniteQuery.data))}
    >
      {shouldShowChapters ? (
        <LibraryGrid
          groups={chaptersWithHref}
          badgeLabel="Chapter"
          isLoading={isLoadingChapters}
          emptyMessage="No chapters found in this volume."
        />
      ) : (
        <LibraryGrid
          comics={flatComics}
          isLoading={infiniteQuery.isLoading}
          fetchNextPage={infiniteQuery.fetchNextPage}
          hasNextPage={infiniteQuery.hasNextPage}
          isFetchingNextPage={infiniteQuery.isFetchingNextPage}
          emptyMessage="No issues found in this volume matching the current filters."
        />
      )}
    </HierarchyPageFrame>
  );
}
