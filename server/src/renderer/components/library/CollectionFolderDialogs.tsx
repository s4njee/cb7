import React from 'react';
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

export interface CreateCollectionDialogProps {
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

export interface CreateFolderDialogProps {
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
