import React from 'react';
import { useUiStore } from '@/store/uiStore';
import { X } from 'lucide-react';

const MEDIA_LABEL: Record<string, string> = { comic: 'Comics', book: 'Books' };
const STATUS_LABEL: Record<string, string> = {
  unread: 'Unread',
  'in-progress': 'In Progress',
  completed: 'Completed',
};

/**
 * Removable chips for every active catalog filter (P3-1): media type, read
 * status, format, favorites, and the search term — each dismissable on its own,
 * plus one Reset that clears them all. Reads/writes `uiStore` directly.
 */
export default function ActiveFilterChips() {
  const {
    search, setSearch,
    mediaType, setMediaType,
    readStatus, setReadStatus,
    fileExt, setFileExt,
    favoritesOnly, setFavoritesOnly,
    resetFilters,
  } = useUiStore();

  const chips: { key: string; label: string; onClear: () => void }[] = [];
  if (search.trim()) chips.push({ key: 'search', label: `Search: ${search.trim()}`, onClear: () => setSearch('') });
  if (mediaType) chips.push({ key: 'media', label: MEDIA_LABEL[mediaType] ?? mediaType, onClear: () => setMediaType('') });
  if (readStatus) chips.push({ key: 'status', label: STATUS_LABEL[readStatus] ?? readStatus, onClear: () => setReadStatus('') });
  if (fileExt) chips.push({ key: 'format', label: fileExt.toUpperCase(), onClear: () => setFileExt('') });
  if (favoritesOnly) chips.push({ key: 'favs', label: 'Favorites', onClear: () => setFavoritesOnly(false) });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 md:px-10 pb-3 select-none">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onClear}
            aria-label={`Remove ${chip.label} filter`}
            className="text-primary/70 hover:text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={resetFilters}
        className="text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-2"
      >
        Reset
      </button>
    </div>
  );
}
