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
import { Heart, ChevronDown, Check } from 'lucide-react';
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

const SORT_OPTIONS: { value: SortByFilter; label: string }[] = [
  { value: 'dateAdded', label: 'Recent' },
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
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
  } = useUiStore();

  const currentSort = SORT_OPTIONS.find((o) => o.value === sortBy) ?? SORT_OPTIONS[0];
  const currentOrder = SORT_ORDER_OPTIONS.find((o) => o.value === sortOrder) ?? SORT_ORDER_OPTIONS[0];

  return (
    <div className="px-4 md:px-10 pt-5 pb-3 select-none">
      {/* Section label + sort field + sort direction */}
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-section">
          All books
        </h2>
        <div className="flex items-center gap-3 shrink-0">
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
      </div>
    </div>
  );
}
