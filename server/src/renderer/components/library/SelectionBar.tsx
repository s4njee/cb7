import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { useSelectionStore } from '@/store/selectionStore';
import { useUiStore } from '@/store/uiStore';
import { comicQueryOptionsFromFilters } from '@/lib/catalogQueryHelpers';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Trash2,
  FolderPlus,
  Library as LibraryIcon,
  X,
  Plus,
  CheckCheck,
  RotateCcw,
  ListChecks,
  Pencil,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { CreateCollectionDialog, CreateFolderDialog } from './ContextMenuDialogs';
import { BatchMetadataDialog } from './BatchMetadataDialog';

export interface SelectionBarProps {
  /**
   * When provided (the page passed a scope), the "Select all matching" button
   * is shown and the matching query is scoped to the given library/tag/folder.
   * Omit it on pages where "select all" has no meaningful scope.
   */
  matchingScope?: { libraryId?: number; tag?: string; folderId?: number };
}

export default function SelectionBar({ matchingScope }: SelectionBarProps = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const clearSelection = useSelectionStore((state) => state.clearSelection);
  const mediaType = useUiStore((state) => state.mediaType);
  const sortBy = useUiStore((state) => state.sortBy);
  const sortOrder = useUiStore((state) => state.sortOrder);
  const fileExt = useUiStore((state) => state.fileExt);
  const readStatus = useUiStore((state) => state.readStatus);
  const favoritesOnly = useUiStore((state) => state.favoritesOnly);
  const setReadStatus = useUiStore((state) => state.setReadStatus);

  const { data: session } = useQuery({ queryKey: ['session'], queryFn: api.getSession });
  const isAdmin = session?.user?.isAdmin === true;

  const [createCollectionOpen, setCreateCollectionOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionMediaType, setNewCollectionMediaType] = useState<'comic' | 'book'>('comic');
  const [newFolderName, setNewFolderName] = useState('');

  const count = selectedIds.length;
  const isVisible = count > 0;

  const { data: libraries = [] } = useQuery({
    queryKey: ['libraries'],
    queryFn: () => api.fetchLibraries(),
    enabled: isVisible,
  });

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: api.fetchFolders,
    enabled: isVisible,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(selectedIds.map((id) => api.deleteComic(id)));
    },
    onSuccess: () => {
      toast.success(`Removed ${count} item${count === 1 ? '' : 's'} from library database.`);
      queryClient.invalidateQueries();
      clearSelection();
    },
    onError: (err) => {
      toast.error(`Delete failed: ${err.message}`);
    },
  });

  const addToCollectionMutation = useMutation({
    mutationFn: async ({ libraryId }: { libraryId: number }) => {
      await api.addComicsToLibrary(libraryId, selectedIds);
    },
    onSuccess: (_, variables) => {
      const libName = libraries.find((l) => l.id === variables.libraryId)?.name || 'Collection';
      toast.success(`Added ${count} item${count === 1 ? '' : 's'} to "${libName}".`);
      queryClient.invalidateQueries();
      clearSelection();
    },
    onError: (err) => {
      toast.error(`Add failed: ${err.message}`);
    },
  });

  const addToFolderMutation = useMutation({
    mutationFn: async ({ folderId }: { folderId: number }) => {
      await api.addComicsToFolder(folderId, selectedIds);
    },
    onSuccess: (_, variables) => {
      const folderName = folders.find((f) => f.id === variables.folderId)?.name || 'Folder';
      toast.success(`Added ${count} item${count === 1 ? '' : 's'} to folder "${folderName}".`);
      queryClient.invalidateQueries();
      clearSelection();
    },
    onError: (err) => {
      toast.error(`Add failed: ${err.message}`);
    },
  });

  const createCollectionMutation = useMutation({
    mutationFn: async () => {
      const library = await api.createLibrary(newCollectionName.trim(), newCollectionMediaType);
      if (selectedIds.length > 0) {
        await api.addComicsToLibrary(library.id, selectedIds);
      }
      return library;
    },
    onSuccess: (library) => {
      toast.success(
        selectedIds.length > 0
          ? `Created "${library.name}" and added ${count} item${count === 1 ? '' : 's'}.`
          : `Created collection "${library.name}".`,
      );
      queryClient.invalidateQueries();
      setCreateCollectionOpen(false);
      setNewCollectionName('');
      clearSelection();
    },
    onError: (err) => {
      toast.error(`Create collection failed: ${err.message}`);
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async () => api.createFolder(newFolderName.trim(), selectedIds),
    onSuccess: (folder) => {
      toast.success(
        selectedIds.length > 0
          ? `Created folder "${folder.name}" and added ${count} item${count === 1 ? '' : 's'}.`
          : `Created folder "${folder.name}".`,
      );
      queryClient.invalidateQueries();
      setCreateFolderOpen(false);
      setNewFolderName('');
      clearSelection();
    },
    onError: (err) => {
      toast.error(`Create folder failed: ${err.message}`);
    },
  });

  // Mark Read / Mark Unread (same semantics as the context menu)
  const markReadMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(selectedIds.map((id) => api.setCompleted(id, true)));
    },
    onSuccess: () => {
      toast.success(`Marked ${count} item${count === 1 ? '' : 's'} as completed.`);
      queryClient.invalidateQueries();
      clearSelection();
      if (readStatus) setReadStatus('');
    },
    onError: (err) => {
      toast.error(`Operation failed: ${err.message}`);
    },
  });

  const markUnreadMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(selectedIds.map((id) => api.clearProgress(id)));
    },
    onSuccess: () => {
      toast.success(`Cleared reading progress for ${count} item${count === 1 ? '' : 's'}.`);
      queryClient.invalidateQueries();
      clearSelection();
      if (readStatus) setReadStatus('');
    },
    onError: (err) => {
      toast.error(`Operation failed: ${err.message}`);
    },
  });

  // Select all matching (only meaningful when the page passed a scope)
  const selectAllMatchingMutation = useMutation({
    mutationFn: async () => {
      const filters = comicQueryOptionsFromFilters({
        mediaType,
        sortBy,
        sortOrder,
        fileExt,
        readStatus,
        favoritesOnly,
      });
      return api.fetchMatchingComicIds({ ...filters, ...matchingScope });
    },
    onSuccess: (result) => {
      useSelectionStore.getState().setSelection(result.ids);
      toast.success(
        result.truncated
          ? `Selected first ${result.ids.length} of ${result.totalCount} matching`
          : `Selected ${result.ids.length} matching item${result.ids.length === 1 ? '' : 's'}.`,
      );
    },
    onError: (err) => {
      toast.error(`Select all matching failed: ${err.message}`);
    },
  });

  // Batch metadata edit (admin only)
  const updateMetadataMutation = useMutation({
    mutationFn: (fields: api.BatchMetadataFields) => api.batchUpdateMetadata(selectedIds, fields),
    onSuccess: () => {
      toast.success(`Updated metadata for ${count} item${count === 1 ? '' : 's'}.`);
      queryClient.invalidateQueries();
      clearSelection();
      setMetadataOpen(false);
    },
    onError: (err) => {
      toast.error(`Metadata update failed: ${err.message}`);
    },
  });

  // Batch cover refresh (admin only); keeps the selection so the user can keep working.
  const refreshCoversMutation = useMutation({
    mutationFn: () => api.batchRefreshCovers(selectedIds),
    onSuccess: () => {
      toast.success(`Cover refresh started for ${count} item${count === 1 ? '' : 's'}.`);
      queryClient.invalidateQueries();
    },
    onError: (err) => {
      toast.error(`Cover refresh failed: ${err.message}`);
    },
  });

  const openCreateCollection = () => {
    setNewCollectionName('');
    setNewCollectionMediaType(mediaType === 'book' ? 'book' : 'comic');
    setCreateCollectionOpen(true);
  };

  const openCreateFolder = () => {
    setNewFolderName('');
    setCreateFolderOpen(true);
  };

  if (!isVisible) return null;

  return (
    <>
      <div className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 bg-card/90 backdrop-blur-md border border-border shadow-2xl rounded-full select-none max-w-[90vw] md:max-w-2xl">
        <div className="flex items-center gap-2 pr-2 border-r border-border shrink-0">
          <span className="text-xs font-semibold text-primary">{count} selected</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={clearSelection}
            className="h-5 w-5 hover:bg-muted p-0 text-muted-foreground hover:text-foreground rounded-full"
            aria-label="Clear selection"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 bg-secondary border-border gap-1.5 text-xs rounded-full font-medium"
              >
                <LibraryIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add to Collection</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="bg-card border-border min-w-40 max-h-56 overflow-y-auto">
              <DropdownMenuItem
                onClick={openCreateCollection}
                className="gap-2 cursor-pointer focus:bg-muted font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create new collection…</span>
              </DropdownMenuItem>
              {libraries.length > 0 && <DropdownMenuSeparator className="bg-border" />}
              {libraries.map((lib) => (
                <DropdownMenuItem
                  key={lib.id}
                  onClick={() => addToCollectionMutation.mutate({ libraryId: lib.id })}
                  className="cursor-pointer focus:bg-muted"
                >
                  {lib.name}
                </DropdownMenuItem>
              ))}
              {libraries.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground/60 italic text-xs">
                  No existing collections
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 bg-secondary border-border gap-1.5 text-xs rounded-full font-medium"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add to Folder</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="bg-card border-border min-w-40 max-h-56 overflow-y-auto">
              <DropdownMenuItem
                onClick={openCreateFolder}
                className="gap-2 cursor-pointer focus:bg-muted font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create new folder…</span>
              </DropdownMenuItem>
              {folders.length > 0 && <DropdownMenuSeparator className="bg-border" />}
              {folders.map((folder) => (
                <DropdownMenuItem
                  key={folder.id}
                  onClick={() => addToFolderMutation.mutate({ folderId: folder.id })}
                  className="cursor-pointer focus:bg-muted"
                >
                  {folder.name}
                </DropdownMenuItem>
              ))}
              {folders.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground/60 italic text-xs">
                  No existing folders
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            onClick={() => markReadMutation.mutate()}
            disabled={markReadMutation.isPending}
            className="h-8 bg-secondary border-border gap-1.5 text-xs rounded-full font-medium"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Mark Read</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => markUnreadMutation.mutate()}
            disabled={markUnreadMutation.isPending}
            className="h-8 bg-secondary border-border gap-1.5 text-xs rounded-full font-medium"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Mark Unread</span>
          </Button>

          {matchingScope && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => selectAllMatchingMutation.mutate()}
              disabled={selectAllMatchingMutation.isPending}
              className="h-8 bg-secondary border-border gap-1.5 text-xs rounded-full font-medium"
            >
              {selectAllMatchingMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ListChecks className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {selectAllMatchingMutation.isPending ? 'Selecting…' : 'Select all matching'}
              </span>
            </Button>
          )}

          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMetadataOpen(true)}
              className="h-8 bg-secondary border-border gap-1.5 text-xs rounded-full font-medium"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Edit metadata</span>
            </Button>
          )}

          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshCoversMutation.mutate()}
              disabled={refreshCoversMutation.isPending}
              className="h-8 bg-secondary border-border gap-1.5 text-xs rounded-full font-medium"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Refresh covers</span>
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm(`Are you sure you want to remove these ${count} database entries? (Underlying files on disk will NOT be deleted).`)) {
                deleteMutation.mutate();
              }
            }}
            className="h-8 bg-secondary border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 gap-1.5 text-xs text-destructive rounded-full font-medium"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Remove Entries</span>
          </Button>
        </div>
      </div>

      <CreateCollectionDialog
        open={createCollectionOpen}
        onOpenChange={setCreateCollectionOpen}
        name={newCollectionName}
        onNameChange={setNewCollectionName}
        mediaType={newCollectionMediaType}
        onMediaTypeChange={setNewCollectionMediaType}
        itemCount={count}
        isCreating={createCollectionMutation.isPending}
        onCreate={() => createCollectionMutation.mutate()}
      />
      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        name={newFolderName}
        onNameChange={setNewFolderName}
        itemCount={count}
        isCreating={createFolderMutation.isPending}
        onCreate={() => createFolderMutation.mutate()}
      />
      <BatchMetadataDialog
        open={metadataOpen}
        onOpenChange={setMetadataOpen}
        itemCount={count}
        isSaving={updateMetadataMutation.isPending}
        onSave={(fields) => updateMetadataMutation.mutate(fields)}
      />
    </>
  );
}
