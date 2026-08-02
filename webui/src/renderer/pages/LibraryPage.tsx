import React, { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useUiStore } from '@/store/uiStore';
import * as api from '@/lib/api';
import LibraryGrid from '@/components/library/LibraryGrid';
import FilterStrips from '@/components/library/FilterStrips';
import SelectionBar from '@/components/library/SelectionBar';
import Breadcrumb from '@/components/library/Breadcrumb';
import EditableCollectionHeaderActions from '@/components/library/EditableCollectionHeaderActions';
import { useToast } from '@/hooks/useToast';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { useSelectionStore } from '@/store/selectionStore';
import {
  CATALOG_PAGE_SIZE,
  catalogPageOffset,
  comicQueryOptionsFromFilters,
  nextCatalogPageParam,
} from '@/lib/catalogQueryHelpers';

export default function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  const libraryId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const clearSelection = useSelectionStore((state) => state.clearSelection);

  const {
    mediaType,
    sortBy,
    sortOrder,
    fileExt,
    readStatus,
    favoritesOnly,
  } = useUiStore();

  // Query to find library details
  const { data: libraries = [] } = useQuery<api.Library[]>({
    queryKey: ['libraries'],
    queryFn: () => api.fetchLibraries(),
  });

  const activeLibrary = libraries.find((l) => l.id === libraryId);

  const renameMutation = useMutation({
    mutationFn: (name: string) => api.renameLibrary(libraryId, name),
    onSuccess: async () => {
      await invalidateLibraryQueries(queryClient);
      toast.success('Collection renamed');
    },
    onError: (err) => toast.error(`Rename failed: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteLibrary(libraryId),
    onSuccess: async () => {
      await invalidateLibraryQueries(queryClient);
      toast.success('Collection deleted');
      navigate('/', { replace: true });
    },
    onError: (err) => toast.error(`Delete failed: ${err.message}`),
  });

  const removeSelectedMutation = useMutation({
    mutationFn: () => api.removeComicsFromLibrary(libraryId, selectedIds),
    onSuccess: async () => {
      await invalidateLibraryQueries(queryClient);
      toast.success(`Removed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} from collection`);
      clearSelection();
    },
    onError: (err) => toast.error(`Remove failed: ${err.message}`),
  });

  const handleRename = () => {
    if (!activeLibrary) return;
    const nextName = window.prompt('Rename collection', activeLibrary.name)?.trim();
    if (!nextName || nextName === activeLibrary.name) return;
    renameMutation.mutate(nextName);
  };

  const handleDelete = () => {
    if (!activeLibrary) return;
    const confirmed = window.confirm(
      `Delete collection "${activeLibrary.name}"? Items stay in the library.`
    );
    if (confirmed) deleteMutation.mutate();
  };

  const filters = comicQueryOptionsFromFilters({
    mediaType,
    sortBy,
    sortOrder,
    fileExt,
    readStatus,
    favoritesOnly,
  });

  // Infinite query for library comics list
  const infiniteQuery = useInfiniteQuery({
    queryKey: ['library-comics', libraryId, filters],
    queryFn: async ({ pageParam = 0 }) => {
      return api.fetchLibraryComics(libraryId, {
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
        <EditableCollectionHeaderActions
          countLabel={activeLibrary ? `${activeLibrary.comicCount} total items` : ''}
          canEdit={Boolean(activeLibrary)}
          selectedCount={selectedIds.length}
          removePending={removeSelectedMutation.isPending}
          renamePending={renameMutation.isPending}
          deletePending={deleteMutation.isPending}
          onRemoveSelected={() => removeSelectedMutation.mutate()}
          onRename={handleRename}
          onDelete={handleDelete}
        />
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
          emptyMessage="No items found matching the current filters in this collection."
        />
      </div>

      <SelectionBar />
    </div>
  );
}
