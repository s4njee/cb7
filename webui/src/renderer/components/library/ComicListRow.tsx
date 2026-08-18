import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebComicRecord } from '@/lib/api';
import { isFinished, progressPercentFor } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Check, Heart } from 'lucide-react';
import { useSelectionStore } from '@/store/selectionStore';
import { cn } from '@/lib/utils';
import TypographicCover from './TypographicCover';

interface ComicListRowProps {
  record: WebComicRecord;
  isAdmin: boolean;
  orderedIds: number[];
  compact: boolean;
  onContextMenu: (e: React.MouseEvent, record: WebComicRecord) => void;
}

/** Compact library row for list view: small cover + title + status + progress. */
function ComicListRow({ record, isAdmin, orderedIds, compact, onContextMenu }: ComicListRowProps) {
  const navigate = useNavigate();
  const [imgFailed, setImgFailed] = useState(false);

  const isSelected = useSelectionStore((s) => s.selectedIds.includes(record.id));
  const hasSelection = useSelectionStore((s) => s.selectedIds.length > 0);
  const toggleSelect = useSelectionStore((s) => s.toggleSelect);
  const selectRange = useSelectionStore((s) => s.selectRange);

  const isCompleted = isFinished(record);
  const progressPercent = progressPercentFor(record);
  const statusLabel = record.missingAt
    ? 'Missing'
    : isCompleted
      ? 'Read'
      : progressPercent > 0
        ? `${progressPercent}% read`
        : 'New';

  const handleClick = (e: React.MouseEvent) => {
    if (hasSelection && isAdmin) {
      if (e.shiftKey) selectRange(record.id, orderedIds);
      else toggleSelect(record.id);
    } else {
      navigate(`/read/${record.id}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick(e as unknown as React.MouseEvent);
    }
  };

  return (
    <div
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => onContextMenu(e, record)}
      role="link"
      tabIndex={0}
      aria-label={`${record.title}, ${statusLabel}`}
      className={cn(
        'flex items-center gap-3 rounded-md px-2 cursor-pointer select-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary focus:outline-none',
        compact ? 'py-1.5' : 'py-2.5',
      )}
      data-id={record.id}
    >
      <div className="h-12 w-9 shrink-0 overflow-hidden rounded-[var(--radius-cover)] border border-border bg-secondary">
        {imgFailed ? (
          <TypographicCover title={record.title} mediaType={record.mediaType} />
        ) : (
          <img
            src={`/api/comics/${record.id}/thumbnail?v=${encodeURIComponent(record.dateAdded)}`}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setImgFailed(true)}
          />
        )}
      </div>

      {isAdmin && (
        <div
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) selectRange(record.id, orderedIds);
            else toggleSelect(record.id);
          }}
          className="shrink-0"
        >
          <Checkbox
            checked={isSelected}
            aria-label={isSelected ? `Deselect ${record.title}` : `Select ${record.title}`}
            className="bg-card border-muted-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary h-4 w-4 rounded"
          />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{record.title}</span>
          {record.missingAt && (
            <span className="shrink-0 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
              Missing
            </span>
          )}
          {isCompleted && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          {record.favorited && <Heart className="h-3 w-3 shrink-0 fill-red-500 text-red-500" />}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span
            className={cn(
              'text-[11px]',
              record.missingAt
                ? 'text-red-600'
                : progressPercent > 0 && !isCompleted
                  ? 'text-primary'
                  : 'text-section',
            )}
          >
            {record.missingAt ? 'Missing' : isCompleted ? 'Read' : progressPercent > 0 ? `${progressPercent}%` : 'New'}
          </span>
          {progressPercent > 0 && !isCompleted && (
            <div className="h-1 max-w-24 flex-1 overflow-hidden rounded-full bg-black/20">
              <div className="h-full bg-primary" style={{ width: `${progressPercent}%` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(ComicListRow);
