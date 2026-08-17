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

export interface EditTagsDialogProps {
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
