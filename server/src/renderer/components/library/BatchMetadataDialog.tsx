import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BatchMetadataFields } from '@/lib/api/types';
import { parseTagText } from './contextMenuHelpers';

export interface BatchMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemCount: number;
  isSaving: boolean;
  onSave: (fields: BatchMetadataFields) => void;
}

export function BatchMetadataDialog({
  open,
  onOpenChange,
  itemCount,
  isSaving,
  onSave,
}: BatchMetadataDialogProps) {
  const [author, setAuthor] = useState('');
  const [series, setSeries] = useState('');
  const [volume, setVolume] = useState('');
  const [year, setYear] = useState('');
  const [summary, setSummary] = useState('');
  const [tagsText, setTagsText] = useState('');

  // Reset each time the dialog opens so a cancelled attempt never carries its
  // values into the next attempt.
  useEffect(() => {
    if (open) {
      setAuthor('');
      setSeries('');
      setVolume('');
      setYear('');
      setSummary('');
      setTagsText('');
    }
  }, [open]);

  const handleSave = () => {
    const fields: BatchMetadataFields = {};

    if (author.trim() !== '') fields.author = author.trim();
    if (series.trim() !== '') fields.seriesName = series.trim();
    if (volume.trim() !== '') {
      const n = Number(volume);
      if (Number.isFinite(n)) fields.volumeNumber = n;
    }
    if (year.trim() !== '') {
      const n = Number(year);
      if (Number.isFinite(n)) fields.year = n;
    }
    if (summary.trim() !== '') fields.summary = summary.trim();

    const tags = parseTagText(tagsText);
    if (tags.length > 0) fields.tags = tags;

    onSave(fields);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-foreground text-left">Edit Metadata</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (itemCount > 0) handleSave();
          }}
        >
          <div className="space-y-1.5 text-left">
            <Label htmlFor="batch-author" className="text-foreground">
              Author
            </Label>
            <Input
              id="batch-author"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              className="bg-secondary border-border"
              autoFocus
            />
          </div>

          <div className="space-y-1.5 text-left">
            <Label htmlFor="batch-series" className="text-foreground">
              Series
            </Label>
            <Input
              id="batch-series"
              value={series}
              onChange={(event) => setSeries(event.target.value)}
              className="bg-secondary border-border"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 text-left">
              <Label htmlFor="batch-volume" className="text-foreground">
                Volume
              </Label>
              <Input
                id="batch-volume"
                value={volume}
                onChange={(event) => setVolume(event.target.value)}
                className="bg-secondary border-border"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5 text-left">
              <Label htmlFor="batch-year" className="text-foreground">
                Year
              </Label>
              <Input
                id="batch-year"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                className="bg-secondary border-border"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="space-y-1.5 text-left">
            <Label htmlFor="batch-summary" className="text-foreground">
              Summary
            </Label>
            <Input
              id="batch-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              className="bg-secondary border-border"
            />
          </div>

          <div className="space-y-1.5 text-left">
            <Label htmlFor="batch-tags" className="text-foreground">
              Tags
            </Label>
            <Input
              id="batch-tags"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              className="bg-secondary border-border"
              placeholder="action, omnibus, favorite"
            />
            <p className="text-[10px] text-muted-foreground">
              Separate tags with commas. Tags replace existing tags on all selected items. Blank
              fields are left untouched.
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
              disabled={isSaving || itemCount === 0}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
