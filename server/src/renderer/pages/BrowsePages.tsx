import { useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useUiStore } from '@/store/uiStore';
import * as api from '@/lib/api';
import LibraryGrid from '@/components/library/LibraryGrid';
import { GROUP_NONE_KEY, itemCountLabel } from '@/lib/utils';
import HierarchyPageFrame from './HierarchyPageFrame';
import {
  CATALOG_PAGE_SIZE,
  catalogPageOffset,
  comicQueryOptionsFromFilters,
  hierarchyQueryOptionsFromFilters,
  nextCatalogPageParam,
} from '@/lib/catalogQueryHelpers';
import {
  browseChapterHref,
  firstPageTotalCount,
  hasUnnumberedVolume,
  isSingleUnnumberedVolume,
  namedVolumeGroups,
  recordsFromPages,
  shouldShowChapterGroups,
} from './hierarchyPageHelpers';

function useBrowseRouteOptions() {
  const {
    mediaType,
    sortBy,
    sortOrder,
    search,
    fileExt,
    readStatus,
    favoritesOnly,
  } = useUiStore();

  const groupFilters = hierarchyQueryOptionsFromFilters({
    mediaType,
    search,
    fileExt,
    readStatus,
    favoritesOnly,
  });

  const queryOpts = comicQueryOptionsFromFilters({
    mediaType,
    sortBy,
    sortOrder,
    fileExt,
    readStatus,
    favoritesOnly,
  }, { defaultSortBy: 'title' });

  return { groupFilters, queryOpts };
}

// 1. Browse Series Page — renders volumes + unnumbered issues mixed view or flat comics if single unnumbered
export function BrowseSeriesPage() {
  const { k } = useParams<{ k: string }>();
  const seriesKey = k || '';
  const { groupFilters, queryOpts } = useBrowseRouteOptions();

  // Fetch volume groups
  const { data: volumesResponse, isLoading: isLoadingVolumes } = useQuery({
    queryKey: ['browse-volumes', seriesKey, groupFilters],
    queryFn: () => api.fetchBrowseSeriesVolumes(seriesKey, groupFilters),
    enabled: !!seriesKey,
  });

  const allVolumeGroups = volumesResponse?.groups || [];
  const isSingleUnnumbered = isSingleUnnumberedVolume(allVolumeGroups);

  // Query 1a: Infinite flat comics (if single unnumbered)
  const infiniteQuery = useInfiniteQuery({
    queryKey: ['browse-volume-comics-flat', seriesKey, GROUP_NONE_KEY, queryOpts],
    queryFn: async ({ pageParam = 0 }) => {
      return api.fetchBrowseVolumeComics(seriesKey, GROUP_NONE_KEY, {
        ...queryOpts,
        limit: CATALOG_PAGE_SIZE,
        offset: catalogPageOffset(pageParam),
      });
    },
    initialPageParam: 0,
    getNextPageParam: nextCatalogPageParam,
    enabled: !!seriesKey && isSingleUnnumbered,
  });

  // Query 1b: Mixed unnumbered issues list (if not single unnumbered volume)
  const { data: unnumberedResponse, isLoading: isLoadingUnnumbered } = useQuery({
    queryKey: ['browse-volume-comics-unnumbered', seriesKey, GROUP_NONE_KEY, queryOpts],
    queryFn: () => api.fetchBrowseVolumeComics(seriesKey, GROUP_NONE_KEY, {
      ...queryOpts,
      limit: 200,
    }),
    enabled: !!seriesKey && !isSingleUnnumbered && hasUnnumberedVolume(allVolumeGroups),
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
          groupHrefPrefix={`/browse/series/${encodeURIComponent(seriesKey)}/volume/`}
          isLoading={isLoadingVolumes || isLoadingUnnumbered}
          emptyMessage="No volumes or issues found in this series matching the filters."
        />
      )}
    </HierarchyPageFrame>
  );
}

// 2. Browse Volume Page — renders chapters list OR flat comics if shouldShowChapters is false
export function BrowseVolumePage() {
  const { k, v } = useParams<{ k: string; v: string }>();
  const seriesKey = k || '';
  const volumeKey = v || '';
  const { groupFilters, queryOpts } = useBrowseRouteOptions();

  // Fetch chapters
  const { data: chaptersResponse, isLoading: isLoadingChapters } = useQuery({
    queryKey: ['browse-chapters', seriesKey, volumeKey, groupFilters],
    queryFn: () => api.fetchBrowseVolumeChapters(seriesKey, volumeKey, groupFilters),
    enabled: !!seriesKey && !!volumeKey,
  });

  const chapterGroups = chaptersResponse?.groups || [];
  const shouldShowChapters = shouldShowChapterGroups(chapterGroups);

  // Fetch flat comics if we skip chapters
  const infiniteQuery = useInfiniteQuery({
    queryKey: ['browse-volume-comics-flat', seriesKey, volumeKey, queryOpts],
    queryFn: async ({ pageParam = 0 }) => {
      return api.fetchBrowseVolumeComics(seriesKey, volumeKey, {
        ...queryOpts,
        limit: CATALOG_PAGE_SIZE,
        offset: catalogPageOffset(pageParam),
      });
    },
    initialPageParam: 0,
    getNextPageParam: nextCatalogPageParam,
    enabled: !!seriesKey && !!volumeKey && !shouldShowChapters,
  });

  const flatComics = recordsFromPages(infiniteQuery.data);

  const chaptersWithHref = chapterGroups.map((g) => ({
    ...g,
    href: browseChapterHref(seriesKey, volumeKey, g),
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

// 3. Browse Chapter Page — renders flat comics inside chapter
export function BrowseChapterPage() {
  const { k, v, c } = useParams<{ k: string; v: string; c: string }>();
  const seriesKey = k || '';
  const volumeKey = v || '';
  const chapterKey = c || '';
  const { queryOpts } = useBrowseRouteOptions();

  const infiniteQuery = useInfiniteQuery({
    queryKey: ['browse-chapter-comics', seriesKey, volumeKey, chapterKey, queryOpts],
    queryFn: async ({ pageParam = 0 }) => {
      return api.fetchBrowseChapterComics(seriesKey, volumeKey, chapterKey, {
        ...queryOpts,
        limit: CATALOG_PAGE_SIZE,
        offset: catalogPageOffset(pageParam),
      });
    },
    initialPageParam: 0,
    getNextPageParam: nextCatalogPageParam,
    enabled: !!seriesKey && !!volumeKey && !!chapterKey,
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
