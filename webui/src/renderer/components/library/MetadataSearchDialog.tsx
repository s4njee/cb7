import React from 'react';
import type * as api from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface MetadataSearchDialogProps {
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
  onReReadEmbedded?: () => void;
  isReReading?: boolean;
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
  onReReadEmbedded,
  isReReading,
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
            {onReReadEmbedded && (
              <Button
                type="button"
                variant="outline"
                className="mr-auto border-border text-foreground hover:bg-muted"
                onClick={onReReadEmbedded}
                disabled={isReReading}
              >
                {isReReading ? 'Re-reading…' : 'Re-read embedded metadata'}
              </Button>
            )}
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
