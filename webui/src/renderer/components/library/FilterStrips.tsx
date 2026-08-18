import React from 'react';
import {
  useUiStore,
  ReadStatusFilter,
  MediaTypeFilter,
  SortByFilter,
  SortOrderFilter,
} from '@/store/uiStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Heart, ChevronDown, Check, LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils';

const MEDIA_PILLS: { value: MediaTypeFilter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'comic', label: 'Comics' },
  { value: 'book', label: 'Books' },
];

const READ_STATUS_PILLS: { status: ReadStatusFilter; label: string }[] = [
  { status: '', label: 'All Status' },
  { status: 'unread', label: 'Unread' },
  { status: 'in-progress', label: 'In Progress' },
  { status: 'completed', label: 'Completed' },
];

/** Format (file extension) pills — `fileExt` was wired but never surfaced (P3-1). */
const FORMAT_PILLS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'cbz', label: 'CBZ' },
  { value: 'cbr', label: 'CBR' },
  { value: 'cb7', label: 'CB7' },
  { value: 'epub', label: 'EPUB' },
  { value: 'pdf', label: 'PDF' },
];

const SORT_OPTIONS: { value: SortByFilter; label: string }[] = [
  { value: 'dateAdded', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'lastRead', label: 'Recently read' },
  { value: 'fileSize', label: 'File size' },
  { value: 'pageCount', label: 'Pages' },
];

const SORT_ORDER_OPTIONS: { value: SortOrderFilter; label: string }[] = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

/** A Folio filter pill (accent-filled when active, warm surface otherwise). */
function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-8 shrink-0 rounded-full border px-3.5 text-[13px] transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground font-medium'
          : 'border-border bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export default function FilterStrips() {
  const {
    mediaType,
    setMediaType,
    readStatus,
    setReadStatus,
    favoritesOnly,
    setFavoritesOnly,
    missingOnly,
    setMissingOnly,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    viewMode,
    setViewMode,
    density,
    setDensity,
    fileExt,
    setFileExt,
  } = useUiStore();

  const currentSort = SORT_OPTIONS.find((o) => o.value === sortBy) ?? SORT_OPTIONS[0];
  const currentOrder = SORT_ORDER_OPTIONS.find((o) => o.value === sortOrder) ?? SORT_ORDER_OPTIONS[0];

  return (
    <div className="px-4 md:px-10 pt-5 pb-3 select-none">
      {/* Section label + sort field + sort direction */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
        <h2 className="eyebrow">
          All books
        </h2>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Grid / list view toggle (P3-4), persisted per device class. */}
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              aria-label="Grid view"
              title="Grid view"
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full transition-colors',
                viewMode === 'grid'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              aria-label="List view"
              title="List view"
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full transition-colors',
                viewMode === 'list'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Density (P2-2 / P3-2): looser grid for large-type / large-target users. */}
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setDensity('compact')}
              aria-pressed={density === 'compact'}
              className={cn(
                'rounded-full px-2 py-1 text-[11px] font-medium transition-colors',
                density === 'compact'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Compact
            </button>
            <button
              type="button"
              onClick={() => setDensity('comfortable')}
              aria-pressed={density === 'comfortable'}
              className={cn(
                'rounded-full px-2 py-1 text-[11px] font-medium transition-colors',
                density === 'comfortable'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Comfortable
            </button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-0.5 text-xs text-faint hover:text-foreground">
              Sort: {currentSort.label}
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover border-popover-border">
              {SORT_OPTIONS.map((o) => (
                <DropdownMenuItem
                  key={o.value}
                  onClick={() => setSortBy(o.value)}
                  className="gap-2 cursor-pointer focus:bg-muted"
                >
                  <Check
                    className={cn('h-4 w-4', o.value === sortBy ? 'text-primary' : 'text-transparent')}
                  />
                  {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-0.5 text-xs text-faint hover:text-foreground">
              {currentOrder.label}
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover border-popover-border">
              {SORT_ORDER_OPTIONS.map((o) => (
                <DropdownMenuItem
                  key={o.value}
                  onClick={() => setSortOrder(o.value)}
                  className="gap-2 cursor-pointer focus:bg-muted"
                >
                  <Check
                    className={cn(
                      'h-4 w-4',
                      o.value === sortOrder ? 'text-primary' : 'text-transparent',
                    )}
                  />
                  {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        {MEDIA_PILLS.map((p) => (
          <Pill key={p.value} active={mediaType === p.value} onClick={() => setMediaType(p.value)}>
            {p.label}
          </Pill>
        ))}

        <div className="mx-1 h-6 w-px shrink-0 bg-border" />

        {READ_STATUS_PILLS.map((p) => (
          <Pill
            key={p.status}
            active={readStatus === p.status}
            onClick={() => setReadStatus(p.status)}
          >
            {p.label}
          </Pill>
        ))}

        <button
          type="button"
          onClick={() => setFavoritesOnly(!favoritesOnly)}
          aria-pressed={favoritesOnly}
          className={cn(
            'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors',
            favoritesOnly
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          <Heart className={cn('h-3.5 w-3.5', favoritesOnly && 'fill-current')} />
          <span>Favorites</span>
        </button>

        {/* Missing-file filter (P1-8): only records whose file is gone from disk. */}
        <button
          type="button"
          onClick={() => setMissingOnly(!missingOnly)}
          aria-pressed={missingOnly}
          className={cn(
            'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors',
            missingOnly
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          <span>Missing</span>
        </button>

        <div className="mx-1 h-6 w-px shrink-0 bg-border" />

        {FORMAT_PILLS.map((p) => (
          <Pill key={p.value} active={fileExt === p.value} onClick={() => setFileExt(p.value)}>
            {p.label}
          </Pill>
        ))}
      </div>
    </div>
  );
}
