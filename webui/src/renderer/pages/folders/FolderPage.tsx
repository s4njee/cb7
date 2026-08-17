import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import LibraryGrid from '@/components/library/LibraryGrid';
import EditableCollectionHeaderActions from '@/components/library/EditableCollectionHeaderActions';
import { itemCountLabel } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { useSelectionStore } from '@/store/selectionStore';
import HierarchyPageFrame from '../HierarchyPageFrame';
import { useFolderRouteOptions } from './useFolderRouteOptions';

/**
 * Folder Page — renders series grouped cards inside a folder.
 */
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
