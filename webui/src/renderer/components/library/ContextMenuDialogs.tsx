import type * as api from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface EditTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tagText: string;
  onTagTextChange: (value: string) => void;
  activeCount: number;
  isSaving: boolean;
  onSave: () => void;
}

export function EditTagsDialog({
  open,
  onOpenChange,
  tagText,
  onTagTextChange,
  activeCount,
  isSaving,
  onSave,
}: EditTagsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-foreground text-left">Edit Tags</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (activeCount > 0) onSave();
          }}
        >
          <div className="space-y-1.5 text-left">
            <Label htmlFor="comic-tags" className="text-foreground">
              Tags
            </Label>
            <Input
              id="comic-tags"
              value={tagText}
              onChange={(event) => onTagTextChange(event.target.value)}
              className="bg-secondary border-border"
              placeholder="action, omnibus, favorite"
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">
              Separate tags with commas. Saving replaces tags on all selected items.
            </p>
          </div>
          <div className="flex justify-between gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              className="border-border text-foreground hover:bg-muted"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              disabled={isSaving || activeCount === 0}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface MetadataSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  results: api.MetadataCandidate[];
  warnings: string[];
  canSearch: boolean;
  isSearching: boolean;
  isApplying: boolean;
  onSearch: () => void;
  onApply: (candidate: api.MetadataCandidate) => void;
}

export function MetadataSearchDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  results,
  warnings,
  canSearch,
  isSearching,
  isApplying,
  onSearch,
  onApply,
}: MetadataSearchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground text-left">Search Metadata</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="bg-secondary border-border"
              placeholder="Title"
              autoFocus
            />
            <Button
              type="submit"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              disabled={isSearching || !canSearch}
            >
              {isSearching ? 'Searching...' : 'Search'}
            </Button>
          </div>

          {warnings.length > 0 && (
            <div className="rounded border border-border bg-secondary/30 p-2 text-[11px] text-muted-foreground">
              {warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          )}

          <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
            {results.map((candidate, index) => (
              <button
                key={`${candidate.source ?? 'metadata'}:${candidate.externalId ?? candidate.title ?? index}`}
                type="button"
                onClick={() => onApply(candidate)}
                disabled={isApplying}
                className="w-full text-left rounded-lg border border-border bg-secondary/20 hover:bg-muted p-3 transition-colors disabled:opacity-60"
              >
                <div className="flex gap-3">
                  {candidate.coverUrl ? (
                    <img
                      src={candidate.coverUrl}
                      alt=""
                      className="h-16 w-11 rounded object-cover bg-secondary shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-16 w-11 rounded bg-secondary shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {candidate.title}
                      </span>
                      <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
                        {candidate.source ?? 'metadata'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {[candidate.author, candidate.artist, candidate.year].filter(Boolean).join(' / ') || 'No creator metadata'}
                    </div>
                    {candidate.summary && (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {candidate.summary}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="flex justify-end border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              className="border-border text-foreground hover:bg-muted"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface CreateCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (value: string) => void;
  mediaType: 'comic' | 'book';
  onMediaTypeChange: (value: 'comic' | 'book') => void;
  itemCount: number;
  isCreating: boolean;
  onCreate: () => void;
}

export function CreateCollectionDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  mediaType,
  onMediaTypeChange,
  itemCount,
  isCreating,
  onCreate,
}: CreateCollectionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-foreground text-left">New collection</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onCreate();
          }}
        >
          <div className="space-y-1.5 text-left">
            <Label htmlFor="create-collection-name" className="text-foreground">
              Name
            </Label>
            <Input
              id="create-collection-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              className="bg-secondary border-border"
              placeholder="My collection"
              required
              autoFocus
              disabled={isCreating}
            />
          </div>
          <div className="space-y-1.5 text-left">
            <Label className="text-foreground">Type</Label>
            <Tabs
              value={mediaType}
              onValueChange={(value) => onMediaTypeChange(value as 'comic' | 'book')}
              className="w-full"
            >
              <TabsList className="grid grid-cols-2 bg-secondary border border-border">
                <TabsTrigger value="comic" disabled={isCreating}>Comics</TabsTrigger>
                <TabsTrigger value="book" disabled={isCreating}>Books</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {itemCount > 0 && (
            <p className="text-[11px] text-muted-foreground">
              The {itemCount} selected item{itemCount === 1 ? '' : 's'} will be added after creation.
            </p>
          )}
          <div className="flex justify-between gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              className="border-border text-foreground hover:bg-muted"
              onClick={() => onOpenChange(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              disabled={isCreating || !name.trim()}
            >
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (value: string) => void;
  itemCount: number;
  isCreating: boolean;
  onCreate: () => void;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  itemCount,
  isCreating,
  onCreate,
}: CreateFolderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-foreground text-left">New folder</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onCreate();
          }}
        >
          <div className="space-y-1.5 text-left">
            <Label htmlFor="create-folder-name" className="text-foreground">
              Name
            </Label>
            <Input
              id="create-folder-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              className="bg-secondary border-border"
              placeholder="My folder"
              required
              autoFocus
              disabled={isCreating}
            />
          </div>
          {itemCount > 0 && (
            <p className="text-[11px] text-muted-foreground">
              The {itemCount} selected item{itemCount === 1 ? '' : 's'} will be added after creation.
            </p>
          )}
          <div className="flex justify-between gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              className="border-border text-foreground hover:bg-muted"
              onClick={() => onOpenChange(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              disabled={isCreating || !name.trim()}
            >
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
