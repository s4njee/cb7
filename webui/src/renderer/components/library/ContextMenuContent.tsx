import type * as api from '@/lib/api';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import {
  BookOpen,
  CheckCircle,
  EyeOff,
  FolderPlus,
  Library as LibraryIcon,
  Locate,
  Plus,
  Search,
  Tag,
  Trash2,
} from 'lucide-react';

interface ContextMenuContentProps {
  showSingleTargetActions: boolean;
  libraries: api.Library[];
  folders: api.Folder[];
  onOpenReader: () => void;
  onOpenMetadataSearch: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onAddToCollection: (libraryId: number) => void;
  onAddToFolder: (folderId: number) => void;
  onCreateCollection: () => void;
  onCreateFolder: () => void;
  onEditTags: () => void;
  /** Admin-only: repoint the record at its file's new absolute path. */
  onLocate?: () => void;
  onRemoveLibraryEntry: () => void;
}

export default function ContextMenuContent({
  showSingleTargetActions,
  libraries,
  folders,
  onOpenReader,
  onOpenMetadataSearch,
  onMarkRead,
  onMarkUnread,
  onAddToCollection,
  onAddToFolder,
  onCreateCollection,
  onCreateFolder,
  onEditTags,
  onLocate,
  onRemoveLibraryEntry,
}: ContextMenuContentProps) {
  return (
    <DropdownMenuContent align="start" className="bg-card border-border w-52">
      {showSingleTargetActions && (
        <>
          <DropdownMenuItem onClick={onOpenReader} className="gap-2 cursor-pointer focus:bg-muted">
            <BookOpen className="h-4 w-4" />
            <span>Open Reader</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenMetadataSearch} className="gap-2 cursor-pointer focus:bg-muted">
            <Search className="h-4 w-4" />
            <span>Search Metadata</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border" />
        </>
      )}

      <DropdownMenuItem onClick={onMarkRead} className="gap-2 cursor-pointer focus:bg-muted">
        <CheckCircle className="h-4 w-4 text-green-500" />
        <span>Mark Read</span>
      </DropdownMenuItem>

      <DropdownMenuItem onClick={onMarkUnread} className="gap-2 cursor-pointer focus:bg-muted">
        <EyeOff className="h-4 w-4 text-orange-500" />
        <span>Mark Unread</span>
      </DropdownMenuItem>

      <DropdownMenuSeparator className="bg-border" />

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2 cursor-pointer focus:bg-muted">
          <LibraryIcon className="h-4 w-4" />
          <span>Add to Collection</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent className="bg-card border-border min-w-40 max-h-56 overflow-y-auto">
            <DropdownMenuItem
              onClick={onCreateCollection}
              className="gap-2 cursor-pointer focus:bg-muted font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create new collection…</span>
            </DropdownMenuItem>
            {libraries.length > 0 && <DropdownMenuSeparator className="bg-border" />}
            {libraries.map((lib) => (
              <DropdownMenuItem
                key={lib.id}
                onClick={() => onAddToCollection(lib.id)}
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
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2 cursor-pointer focus:bg-muted">
          <FolderPlus className="h-4 w-4" />
          <span>Add to Folder</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent className="bg-card border-border min-w-40 max-h-56 overflow-y-auto">
            <DropdownMenuItem
              onClick={onCreateFolder}
              className="gap-2 cursor-pointer focus:bg-muted font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create new folder…</span>
            </DropdownMenuItem>
            {folders.length > 0 && <DropdownMenuSeparator className="bg-border" />}
            {folders.map((folder) => (
              <DropdownMenuItem
                key={folder.id}
                onClick={() => onAddToFolder(folder.id)}
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
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>

      <DropdownMenuItem onClick={onEditTags} className="gap-2 cursor-pointer focus:bg-muted">
        <Tag className="h-4 w-4" />
        <span>Edit Tags</span>
      </DropdownMenuItem>

      {onLocate && (
        <>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem onClick={onLocate} className="gap-2 cursor-pointer focus:bg-muted">
            <Locate className="h-4 w-4" />
            <span>Locate…</span>
          </DropdownMenuItem>
        </>
      )}

      <DropdownMenuSeparator className="bg-border" />

      <DropdownMenuItem
        onClick={onRemoveLibraryEntry}
        className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-red-500/10 focus:bg-muted/10 font-medium"
      >
        <Trash2 className="h-4 w-4" />
        <span>Remove Library Entry</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
