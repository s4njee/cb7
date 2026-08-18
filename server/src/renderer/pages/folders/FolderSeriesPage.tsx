import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import LibraryGrid from '@/components/library/LibraryGrid';
import { GROUP_NONE_KEY, itemCountLabel } from '@/lib/utils';
import HierarchyPageFrame from '../HierarchyPageFrame';
import {
  CATALOG_PAGE_SIZE,
  catalogPageOffset,
  nextCatalogPageParam,
} from '@/lib/catalogQueryHelpers';
import {
  firstPageTotalCount,
  hasUnnumberedVolume,
  isSingleUnnumberedVolume,
  namedVolumeGroups,
  recordsFromPages,
} from '../hierarchyPageHelpers';
import { useFolderRouteOptions } from './useFolderRouteOptions';

/**
 * Folder Series Page — renders volumes + unnumbered issues mixed view or flat comics if single unnumbered.
 */
export function FolderSeriesPage() {
  const { id, k } = useParams<{ id: string; k: string }>();
  const folderId = Number(id);
  const seriesKey = k || '';
  const { groupFilters, queryOpts } = useFolderRouteOptions();

  // Fetch volume groups
  const { data: volumesResponse, isLoading: isLoadingVolumes } = useQuery({
    queryKey: ['folder-volumes', folderId, seriesKey, groupFilters],
    queryFn: () => api.fetchFolderSeriesVolumes(folderId, seriesKey, groupFilters),
    enabled: !isNaN(folderId) && !!seriesKey,
  });

  const allVolumeGroups = volumesResponse?.groups || [];
  const isSingleUnnumbered = isSingleUnnumberedVolume(allVolumeGroups);

  // Query 2a: Infinite flat comics (if single unnumbered)
  const infiniteQuery = useInfiniteQuery({
    queryKey: ['folder-volume-comics-flat', folderId, seriesKey, GROUP_NONE_KEY, queryOpts],
    queryFn: async ({ pageParam = 0 }) => {
      return api.fetchFolderVolumeComics(folderId, seriesKey, GROUP_NONE_KEY, {
        ...queryOpts,
        limit: CATALOG_PAGE_SIZE,
        offset: catalogPageOffset(pageParam),
      });
    },
    initialPageParam: 0,
    getNextPageParam: nextCatalogPageParam,
    enabled: !isNaN(folderId) && !!seriesKey && isSingleUnnumbered,
  });

  // Query 2b: Mixed unnumbered issues list (if not single unnumbered volume)
  const { data: unnumberedResponse, isLoading: isLoadingUnnumbered } = useQuery({
    queryKey: ['folder-volume-comics-unnumbered', folderId, seriesKey, GROUP_NONE_KEY, queryOpts],
    queryFn: () => api.fetchFolderVolumeComics(folderId, seriesKey, GROUP_NONE_KEY, {
      ...queryOpts,
      limit: 200,
    }),
    enabled: !isNaN(folderId) && !!seriesKey && !isSingleUnnumbered && hasUnnumberedVolume(allVolumeGroups),
  });

  const flatComics = recordsFromPages(infiniteQuery.data);
  const unnumberedComics = unnumberedResponse?.records || [];
  const namedVolumes = namedVolumeGroups(allVolumeGroups);

  return (
    <HierarchyPageFrame
      countLabel={isSingleUnnumbered
        ? itemCountLabel(firstPageTotalCount(infiniteQuery.data))
        : itemCountLabel(namedVolumes.length + unnumberedComics.length)}
    >
      {isSingleUnnumbered ? (
        <LibraryGrid
          comics={flatComics}
          isLoading={infiniteQuery.isLoading}
          fetchNextPage={infiniteQuery.fetchNextPage}
          hasNextPage={infiniteQuery.hasNextPage}
          isFetchingNextPage={infiniteQuery.isFetchingNextPage}
          emptyMessage="No issues found in this series."
        />
      ) : (
        <LibraryGrid
          groups={namedVolumes}
          comics={unnumberedComics}
          badgeLabel="Volume"
          groupHrefPrefix={`/folder/${folderId}/series/${encodeURIComponent(seriesKey)}/volume/`}
          isLoading={isLoadingVolumes || isLoadingUnnumbered}
          emptyMessage="No volumes or issues found in this series matching the filters."
        />
      )}
    </HierarchyPageFrame>
  );
}
