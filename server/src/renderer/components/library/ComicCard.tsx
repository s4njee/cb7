import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebComicRecord } from '@/lib/api';
import { isFinished, progressPercentFor } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Check, Heart } from 'lucide-react';
import { useSelectionStore } from '@/store/selectionStore';
import { cn } from '@/lib/utils';
import TypographicCover from './TypographicCover';

interface ComicCardProps {
  record: WebComicRecord;
  isAdmin: boolean;
  orderedIds: number[];
  onContextMenu: (e: React.MouseEvent, record: WebComicRecord) => void;
}

function ComicCard({ record, isAdmin, orderedIds, onContextMenu }: ComicCardProps) {
  const navigate = useNavigate();
  const [imgSrc] = useState<string>(
    `/api/comics/${record.id}/thumbnail?v=${encodeURIComponent(record.dateAdded)}`
  );
  const [imgLoading, setImgLoading] = useState(true);
  // On a 404 (no cover), fall back to a generated typographic cover rather than
  // a generic placeholder — matches the Folio design.
  const [hasError, setHasError] = useState(false);

  // Granular subscriptions: derive booleans instead of subscribing to the
  // selectedIds array itself, so toggling a selection only re-renders the
  // affected card (and the whole grid only on the 0 <-> 1 transition) rather
  // than every card on every change.
  const isSelected = useSelectionStore((state) => state.selectedIds.includes(record.id));
  const hasSelection = useSelectionStore((state) => state.selectedIds.length > 0);
  const toggleSelect = useSelectionStore((state) => state.toggleSelect);
  const selectRange = useSelectionStore((state) => state.selectRange);

  // Gesture handling for mobile long-press context menu
  const pressTimer = useRef<NodeJS.Timeout | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    pressTimer.current = setTimeout(() => {
      // Synthesize context menu event
      const touch = e.touches[0];
      const mockEvent = {
        preventDefault: () => {},
        clientX: touch.clientX,
        clientY: touch.clientY,
      } as unknown as React.MouseEvent;
      onContextMenu(mockEvent, record);
    }, 600); // 600ms threshold for long press
  };

  const cancelLongPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handleTouchEnd = cancelLongPress;

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey) {
      selectRange(record.id, orderedIds);
    } else {
      toggleSelect(record.id);
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // If in bulk selection mode, clicking the card toggles selection instead of opening
    if (hasSelection && isAdmin) {
      handleCheckboxClick(e);
    } else {
      // Normal navigate
      navigate(`/read/${record.id}`);
    }
  };

  const isCompleted = isFinished(record);
  const progressPercent = progressPercentFor(record);
  const statusLabel = record.missingAt
    ? 'Missing'
    : isCompleted
      ? 'Read'
      : progressPercent > 0
        ? `${progressPercent}% read`
        : 'New';

  // Keyboard activation (P2-2): the card is a link-shaped control, so Enter or
  // Space opens it — screen readers announce it by title, not just "image".
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick(e as unknown as React.MouseEvent);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => onContextMenu(e, record)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={cancelLongPress}
      onTouchCancel={cancelLongPress}
      role="link"
      tabIndex={0}
      aria-label={`${record.title}, ${statusLabel}`}
      className="cover-card relative flex flex-col group select-none cursor-pointer h-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-md focus:outline-none"
      data-id={record.id}
    >
      {/* 1. Thumbnail Area */}
      <div
        className={cn(
          "cover relative aspect-[2/3] w-full overflow-hidden rounded-[var(--radius-cover)] border border-border bg-secondary transition-colors group-hover:border-primary",
          isSelected && "ring-2 ring-primary"
        )}
      >
        {hasError ? (
          <div className={cn("h-full w-full", (isCompleted || record.missingAt) && "opacity-55")}>
            <TypographicCover title={record.title} mediaType={record.mediaType} />
          </div>
        ) : (
          <img
            src={imgSrc}
            alt={record.title}
            loading="lazy"
            decoding="async"
            className={cn(
              "object-cover w-full h-full transition-transform duration-300 group-hover:scale-105",
              imgLoading ? "opacity-30 blur-xs" : isCompleted || record.missingAt ? "opacity-55" : "opacity-100"
            )}
            onLoad={() => setImgLoading(false)}
            onError={() => {
              setImgLoading(false);
              setHasError(true);
            }}
          />
        )}

        {/* Checkbox (Admin bulk select) */}
        {isAdmin && (
          <div
            onClick={handleCheckboxClick}
            className={cn(
              "absolute top-2 left-2 z-10 transition-opacity duration-200",
              isSelected || hasSelection ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
          >
            <Checkbox
              checked={isSelected}
              aria-label={isSelected ? `Deselect ${record.title}` : `Select ${record.title}`}
              className="bg-card border-muted-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary h-5 w-5 rounded-md"
            />
          </div>
        )}

        {/* Finished check chip */}
        {isCompleted && !record.missingAt && (
          <div className="absolute top-2 right-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-card border border-border">
            <Check className="h-3 w-3 text-muted-foreground" />
          </div>
        )}

        {/* Missing-file chip (P1-8) */}
        {record.missingAt && (
          <div className="absolute top-2 right-2 z-10 flex items-center rounded-full bg-red-600 px-2 py-0.5">
            <span className="text-[9.5px] font-semibold uppercase tracking-wide text-white">Missing</span>
          </div>
        )}

        {/* Favorites Overlay heart icon */}
        {record.favorited && (
          <div className="absolute bottom-2 right-2 z-10 rounded-full border border-foreground/10 bg-[hsl(var(--scrim-soft))] p-1 backdrop-blur-sm">
            <Heart className="h-3 w-3 fill-red-500 text-red-500" />
          </div>
        )}

        {/* Reading progress bar */}
        {progressPercent > 0 && !isCompleted && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-[hsl(var(--scrim-soft))]">
            <div
              className="h-full bg-primary"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* 2. Info Area — title + Folio status line (Read / New / accent %). */}
      <div className="pt-2.5 flex flex-col gap-1">
        <h4 className="text-[12.5px] line-clamp-2 text-foreground leading-[1.25]">
          {record.title}
        </h4>
        <span
          className={cn(
            "text-[11.5px]",
            record.missingAt
              ? "text-red-600"
              : progressPercent > 0 && !isCompleted
                ? "text-primary"
                : "text-section"
          )}
        >
          {record.missingAt ? 'Missing' : isCompleted ? 'Read' : progressPercent > 0 ? `${progressPercent}%` : 'New'}
        </span>
      </div>
    </div>
  );
}

// Memoized so grid-level re-renders (context menu opening, pages appending,
// session refreshes) don't re-render every card. React Query's structural
// sharing keeps `record` references stable, and LibraryGrid memoizes
// `orderedIds`/`onContextMenu`, so the shallow prop check holds.
export default React.memo(ComicCard);
