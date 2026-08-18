import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { useSelectionStore } from '@/store/selectionStore';
import { useUiStore } from '@/store/uiStore';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import ContextMenuContent from './ContextMenuContent';
import {
  CreateCollectionDialog,
  CreateFolderDialog,
  EditTagsDialog,
  MetadataSearchDialog,
} from './ContextMenuDialogs';
import {
  findNameById,
  formatItemCount,
  getContextMenuActiveIds,
  parseTagText,
} from './contextMenuHelpers';

interface ContextMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  x: number;
  y: number;
  targetComic: api.WebComicRecord | null;
}

export default function ContextMenu({
  open,
  onOpenChange,
  x,
  y,
  targetComic,
}: ContextMenuProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const clearSelection = useSelectionStore((state) => state.clearSelection);
  const mediaTypeFilter = useUiStore((state) => state.mediaType);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagText, setTagText] = useState('');
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [metadataQuery, setMetadataQuery] = useState('');
  const [metadataResults, setMetadataResults] = useState<api.MetadataCandidate[]>([]);
  const [metadataWarnings, setMetadataWarnings] = useState<string[]>([]);
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionMediaType, setNewCollectionMediaType] = useState<'comic' | 'book'>('comic');
  const [newFolderName, setNewFolderName] = useState('');

  // Determine if we are acting on selection or a single comic
  const isTargetInSelection = targetComic ? selectedIds.includes(targetComic.id) : false;
  const activeIds = getContextMenuActiveIds(targetComic?.id, selectedIds);

  const count = activeIds.length;
  const itemCountLabel = formatItemCount(count);

  useEffect(() => {
    if (!targetComic || tagDialogOpen) return;
    setTagText(targetComic.tags.join(', '));
  }, [targetComic, tagDialogOpen]);

  // Libraries and Folders list queries
  const { data: libraries = [] } = useQuery({
    queryKey: ['libraries'],
    queryFn: () => api.fetchLibraries(),
    enabled: open,
  });

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: api.fetchFolders,
    enabled: open,
  });

  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
  });
  const isAdmin = session?.user?.isAdmin === true;

  const saveTagsMutation = useMutation({
    mutationFn: async () => {
      const tags = parseTagText(tagText);
      await Promise.all(activeIds.map((id) => api.setComicTags(id, tags)));
    },
    onSuccess: () => {
      toast.success(`Updated tags for ${itemCountLabel}.`);
      queryClient.invalidateQueries();
      clearSelection();
      setTagDialogOpen(false);
    },
    onError: (err) => {
      toast.error(`Tag update failed: ${err.message}`);
    },
  });

  const searchMetadataMutation = useMutation({
    mutationFn: async () => {
      if (!targetComic) return { results: [], warnings: [] };
      return api.searchMetadata(targetComic.id, metadataQuery || targetComic.title);
    },
    onSuccess: (result) => {
      setMetadataResults(result.results ?? []);
      setMetadataWarnings(result.warnings ?? []);
      if ((result.results ?? []).length === 0) {
        toast.info('No metadata matches found.');
      }
    },
    onError: (err) => toast.error(`Metadata search failed: ${err.message}`),
  });

  const applyMetadataMutation = useMutation({
    mutationFn: async (candidate: api.MetadataCandidate) => {
      if (!targetComic) return;
      await api.applyMetadata(targetComic.id, {
        ...candidate,
        externalSource: candidate.source,
      });
    },
    onSuccess: async () => {
      toast.success('Metadata applied');
      queryClient.invalidateQueries();
      setMetadataDialogOpen(false);
    },
    onError: (err) => toast.error(`Metadata apply failed: ${err.message}`),
  });

  const reReadEmbeddedMutation = useMutation({
    mutationFn: async () => {
      if (!targetComic) return { fields: {} as Record<string, string | number | null> };
      return api.refreshEmbeddedMetadata(targetComic.id);
    },
    onSuccess: (result) => {
      const applied = Object.keys(result.fields ?? {});
      if (applied.length === 0) toast.info('No embedded metadata found to apply.');
      else toast.success(`Applied from file: ${applied.join(', ')}.`);
      queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(`Re-read failed: ${err.message}`),
  });

  // Mutator: Locate (repoint a missing record at its file's new path)
  const locateMutation = useMutation({
    mutationFn: async (newPath: string) => {
      if (!targetComic) throw new Error('No comic selected');
      return api.relocateComicPath(targetComic.id, newPath);
    },
    onSuccess: (result) => {
      const basename = result.filePath.split(/[\\/]/).pop() || result.filePath;
      toast.success(`Located to ${basename}`);
      queryClient.invalidateQueries();
      clearSelection();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`Locate failed: ${err.message}`);
    },
  });

  // Mutator: Delete
  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Delete multiple or single record
      await Promise.all(activeIds.map((id) => api.deleteComic(id)));
    },
    onSuccess: () => {
      toast.success(`Removed ${itemCountLabel} from library database.`);
      // Invalidate queries to update lists
      queryClient.invalidateQueries();
      clearSelection();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`Delete failed: ${err.message}`);
    },
  });

  // Mutator: Mark Read (Completed)
  const markReadMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(activeIds.map((id) => api.setCompleted(id, true)));
    },
    onSuccess: () => {
      toast.success(`Marked ${itemCountLabel} as completed.`);
      queryClient.invalidateQueries();
      clearSelection();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`Operation failed: ${err.message}`);
    },
  });

  // Mutator: Mark Unread (Clear progress)
  const markUnreadMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(activeIds.map((id) => api.clearProgress(id)));
    },
    onSuccess: () => {
      toast.success(`Cleared reading progress for ${itemCountLabel}.`);
      queryClient.invalidateQueries();
      clearSelection();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`Operation failed: ${err.message}`);
    },
  });

  // Mutator: Add to Collection
  const addToCollectionMutation = useMutation({
    mutationFn: async ({ libraryId }: { libraryId: number }) => {
      await api.addComicsToLibrary(libraryId, activeIds);
    },
    onSuccess: (_, variables) => {
      const libName = findNameById(libraries, variables.libraryId, 'Collection');
      toast.success(`Added ${itemCountLabel} to "${libName}".`);
      queryClient.invalidateQueries();
      clearSelection();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`Add failed: ${err.message}`);
    },
  });

  // Mutator: Add to Folder
  const addToFolderMutation = useMutation({
    mutationFn: async ({ folderId }: { folderId: number }) => {
      await api.addComicsToFolder(folderId, activeIds);
    },
    onSuccess: (_, variables) => {
      const folderName = findNameById(folders, variables.folderId, 'Folder');
      toast.success(`Added ${itemCountLabel} to folder "${folderName}".`);
      queryClient.invalidateQueries();
      clearSelection();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`Add failed: ${err.message}`);
    },
  });

  const createCollectionMutation = useMutation({
    mutationFn: async () => {
      const library = await api.createLibrary(newCollectionName.trim(), newCollectionMediaType);
      if (activeIds.length > 0) {
        await api.addComicsToLibrary(library.id, activeIds);
      }
      return library;
    },
    onSuccess: (library) => {
      toast.success(
        activeIds.length > 0
          ? `Created "${library.name}" and added ${itemCountLabel}.`
          : `Created collection "${library.name}".`,
      );
      queryClient.invalidateQueries();
      setCreateCollectionOpen(false);
      setNewCollectionName('');
      clearSelection();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`Create collection failed: ${err.message}`);
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async () => api.createFolder(newFolderName.trim(), activeIds),
    onSuccess: (folder) => {
      toast.success(
        activeIds.length > 0
          ? `Created folder "${folder.name}" and added ${itemCountLabel}.`
          : `Created folder "${folder.name}".`,
      );
      queryClient.invalidateQueries();
      setCreateFolderOpen(false);
      setNewFolderName('');
      clearSelection();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`Create folder failed: ${err.message}`);
    },
  });

  const handleOpenReader = () => {
    if (targetComic) {
      navigate(`/read/${targetComic.id}`);
      onOpenChange(false);
    }
  };

  const handleOpenMetadataSearch = () => {
    setMetadataQuery(targetComic?.title ?? '');
    setMetadataResults([]);
    setMetadataWarnings([]);
    setMetadataDialogOpen(true);
    onOpenChange(false);
  };

  const handleEditTags = () => {
    setTagText(targetComic?.tags.join(', ') ?? '');
    setTagDialogOpen(true);
    onOpenChange(false);
  };

  const handleCreateCollection = () => {
    setNewCollectionName('');
    setNewCollectionMediaType(
      targetComic?.mediaType === 'book' || mediaTypeFilter === 'book' ? 'book' : 'comic',
    );
    setCreateCollectionOpen(true);
    onOpenChange(false);
  };

  const handleCreateFolder = () => {
    setNewFolderName('');
    setCreateFolderOpen(true);
    onOpenChange(false);
  };

  const handleLocate = () => {
    if (!targetComic) return;
    const newPath = window.prompt('Enter the new absolute path to this file on disk:');
    if (newPath && newPath.trim()) {
      locateMutation.mutate(newPath.trim());
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        {/*
          Virtual absolute trigger positioned at mouse coords.
          Note pointer-events-none prevents blocking right-clicks.
        */}
        <DropdownMenuTrigger
          style={{
            position: 'fixed',
            left: `${x}px`,
            top: `${y}px`,
            width: '1px',
            height: '1px',
            visibility: 'hidden',
            pointerEvents: 'none',
          }}
        />

        <ContextMenuContent
          showSingleTargetActions={!isTargetInSelection && count === 1}
          libraries={libraries}
          folders={folders}
          onOpenReader={handleOpenReader}
          onOpenMetadataSearch={handleOpenMetadataSearch}
          onMarkRead={() => markReadMutation.mutate()}
          onMarkUnread={() => markUnreadMutation.mutate()}
          onAddToCollection={(libraryId) => addToCollectionMutation.mutate({ libraryId })}
          onAddToFolder={(folderId) => addToFolderMutation.mutate({ folderId })}
          onCreateCollection={handleCreateCollection}
          onCreateFolder={handleCreateFolder}
          onEditTags={handleEditTags}
          onLocate={isAdmin ? handleLocate : undefined}
          onRemoveLibraryEntry={() => deleteMutation.mutate()}
        />
      </DropdownMenu>
      <EditTagsDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        tagText={tagText}
        onTagTextChange={setTagText}
        activeCount={activeIds.length}
        isSaving={saveTagsMutation.isPending}
        onSave={() => saveTagsMutation.mutate()}
      />
      <MetadataSearchDialog
        open={metadataDialogOpen}
        onOpenChange={setMetadataDialogOpen}
        query={metadataQuery}
        onQueryChange={setMetadataQuery}
        results={metadataResults}
        warnings={metadataWarnings}
        canSearch={Boolean(targetComic)}
        isSearching={searchMetadataMutation.isPending}
        isApplying={applyMetadataMutation.isPending}
        onSearch={() => searchMetadataMutation.mutate()}
        onApply={(candidate) => applyMetadataMutation.mutate(candidate)}
        onReReadEmbedded={isAdmin ? () => reReadEmbeddedMutation.mutate() : undefined}
        isReReading={reReadEmbeddedMutation.isPending}
      />
      <CreateCollectionDialog
        open={createCollectionOpen}
        onOpenChange={setCreateCollectionOpen}
        name={newCollectionName}
        onNameChange={setNewCollectionName}
        mediaType={newCollectionMediaType}
        onMediaTypeChange={setNewCollectionMediaType}
        itemCount={activeIds.length}
        isCreating={createCollectionMutation.isPending}
        onCreate={() => createCollectionMutation.mutate()}
      />
      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        name={newFolderName}
        onNameChange={setNewFolderName}
        itemCount={activeIds.length}
        isCreating={createFolderMutation.isPending}
        onCreate={() => createFolderMutation.mutate()}
      />
    </>
  );
}
