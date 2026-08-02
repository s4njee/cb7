import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useUiStore } from '@/store/uiStore';
import * as api from '@/lib/api';
import LibraryGrid from '@/components/library/LibraryGrid';
import EditableCollectionHeaderActions from '@/components/library/EditableCollectionHeaderActions';
import { GROUP_NONE_KEY, itemCountLabel } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { useSelectionStore } from '@/store/selectionStore';
import HierarchyPageFrame from './HierarchyPageFrame';
import {
  CATALOG_PAGE_SIZE,
  catalogPageOffset,
  comicQueryOptionsFromFilters,
  hierarchyQueryOptionsFromFilters,
  nextCatalogPageParam,
} from '@/lib/catalogQueryHelpers';
import {
  firstPageTotalCount,
  folderChapterHref,
  hasUnnumberedVolume,
  isSingleUnnumberedVolume,
  namedVolumeGroups,
  recordsFromPages,
  shouldShowChapterGroups,
} from './hierarchyPageHelpers';

function useFolderRouteOptions() {
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

// 1. Folder Page — renders series grouped cards inside folder
export function FolderPage() {
  const { id } = useParams<{ id: string }>();
  const folderId = Number(id);
  const { groupFilters } = useFolderRouteOptions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const clearSelection = useSelectionStore((state) => state.clearSelection);

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: api.fetchFolders,
  });
  const activeFolder = folders.find((folder) => folder.id === folderId);

  const { data: folderSeriesResponse, isLoading } = useQuery({
    queryKey: ['folder-series', folderId, groupFilters],
    queryFn: () => api.fetchFolderSeries(folderId, groupFilters),
    enabled: !isNaN(folderId),
  });

  const groups = folderSeriesResponse?.groups || [];

  const renameMutation = useMutation({
    mutationFn: (name: string) => api.renameFolder(folderId, name),
    onSuccess: async () => {
      await invalidateLibraryQueries(queryClient);
      toast.success('Folder renamed');
    },
    onError: (err) => toast.error(`Rename failed: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteFolder(folderId),
    onSuccess: async () => {
      await invalidateLibraryQueries(queryClient);
      toast.success('Folder deleted');
      navigate('/', { replace: true });
    },
    onError: (err) => toast.error(`Delete failed: ${err.message}`),
  });

  const removeSelectedMutation = useMutation({
    mutationFn: () => api.removeComicsFromFolder(folderId, selectedIds),
    onSuccess: async () => {
      await invalidateLibraryQueries(queryClient);
      toast.success(`Removed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} from folder`);
      clearSelection();
    },
    onError: (err) => toast.error(`Remove failed: ${err.message}`),
  });

  const handleRename = () => {
    if (!activeFolder) return;
    const nextName = window.prompt('Rename folder', activeFolder.name)?.trim();
    if (!nextName || nextName === activeFolder.name) return;
    renameMutation.mutate(nextName);
  };

  const handleDelete = () => {
    if (!activeFolder) return;
    const confirmed = window.confirm(
      `Delete folder "${activeFolder.name}"? Items stay in the library.`
    );
    if (confirmed) deleteMutation.mutate();
  };

  return (
    <HierarchyPageFrame
      headerActions={
        <EditableCollectionHeaderActions
          countLabel={itemCountLabel(groups.length)}
          canEdit={Boolean(activeFolder)}
          selectedCount={selectedIds.length}
          removePending={removeSelectedMutation.isPending}
          renamePending={renameMutation.isPending}
          deletePending={deleteMutation.isPending}
          onRemoveSelected={() => removeSelectedMutation.mutate()}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      }
    >
      <LibraryGrid
        groups={groups}
        badgeLabel="Series"
        groupHrefPrefix={`/folder/${folderId}/series/`}
        isLoading={isLoading}
        emptyMessage="No series found in this folder matching the current filters."
      />
    </HierarchyPageFrame>
  );
}

// 2. Folder Series Page — renders volumes + unnumbered issues mixed view or flat comics if single unnumbered
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

// 3. Folder Volume Page — renders chapters list OR flat comics if shouldShowChapters is false
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

// 4. Folder Chapter Page — renders flat comics inside chapter
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
