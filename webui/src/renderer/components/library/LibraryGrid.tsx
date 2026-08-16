import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Folder, WebComicRecord } from '@/lib/api';
import ComicCard from './ComicCard';
import ComicListRow from './ComicListRow';
import FolderCard from './FolderCard';
import GroupCard from './GroupCard';
import ContextMenu from './ContextMenu';
import * as api from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { useSelectionStore } from '@/store/selectionStore';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/lib/utils';

interface LibraryGridProps {
  comics?: WebComicRecord[];
  folders?: Folder[];
  groups?: Array<{
    key: string;
    name?: string;
    label?: string;
    count: number;
    coverComicId: number | null;
    thumbnailUrl: string | null;
    href?: string;
  }>;
  badgeLabel?: string;
  groupHrefPrefix?: string; // e.g. "/browse/series/"
  isLoading?: boolean;
  emptyMessage?: string;
  /** Replaces the default empty message with a richer state (empty library, no results, etc.). */
  emptyContent?: React.ReactNode;

  // Infinite scroll properties
  fetchNextPage?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
}

/** Grid column classes by density (compact → one more column per breakpoint). */
const COMFORTABLE_COLS = 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8';
const COMPACT_COLS = 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-10';

export default function LibraryGrid({
  comics = [],
  folders = [],
  groups = [],
  badgeLabel = '',
  groupHrefPrefix = '',
  isLoading = false,
  emptyMessage = 'No items found in this section.',
  emptyContent,
  fetchNextPage,
  hasNextPage = false,
  isFetchingNextPage = false,
}: LibraryGridProps) {
  // Check if admin is logged in (to enable checkbox multi-select)
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
    staleTime: 60000,
  });
  const isAdmin = !!session?.authenticated && session?.user?.isAdmin === true;

  // Per-device view preference (P3-4): card grid vs compact list rows.
  const viewMode = useUiStore((s) => s.viewMode);
  const density = useUiStore((s) => s.density);

  // Context Menu State
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [menuTargetComic, setMenuTargetComic] = useState<WebComicRecord | null>(null);

  // Stable reference so the memoized ComicCards don't re-render when the menu
  // opens/moves (state setters are stable, so no dependencies).
  const handleContextMenu = useCallback((e: React.MouseEvent, record: WebComicRecord) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setMenuTargetComic(record);
    setMenuOpen(true);
  }, []);

  // Infinite Scroll Sentinel Observer
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!fetchNextPage || !hasNextPage || isLoading) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isLoading]);

  // Build the list of ordered IDs currently visible for range selections.
  // Memoized so the memoized ComicCards keep a stable prop between renders.
  const orderedIds = useMemo(() => comics.map((c) => c.id), [comics]);

  if (isLoading && comics.length === 0 && folders.length === 0 && groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground select-none">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm font-medium">Loading catalog...</span>
      </div>
    );
  }

  const isEmpty = comics.length === 0 && folders.length === 0 && groups.length === 0;
  if (isEmpty) {
    if (emptyContent) return <div className="px-4 md:px-10">{emptyContent}</div>;
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm font-medium select-none italic text-center px-4">
        {emptyMessage}
      </div>
    );
  }

  const compact = density === 'compact';

  return (
    <div className="px-4 md:px-10 py-4 select-none">
      {viewMode === 'list' ? (
        /* List view (P3-4): compact rows. */
        <div className="space-y-0.5">
          {folders.map((folder) => (
            <ListNavRow
              key={`folder:${folder.id}`}
              to={`/folder/${folder.id}`}
              title={folder.name}
              meta={`${folder.comicCount} item${folder.comicCount === 1 ? '' : 's'}`}
              thumbnailUrl={folder.thumbnailUrl}
              compact={compact}
            />
          ))}
          {groups.map((group) => (
            <ListNavRow
              key={`group:${group.key}`}
              to={group.href || `${groupHrefPrefix}${encodeURIComponent(group.key)}`}
              title={group.name || group.label || group.key}
              meta={`${group.count} item${group.count === 1 ? '' : 's'}`}
              thumbnailUrl={
                group.thumbnailUrl ||
                (group.coverComicId ? `/api/comics/${group.coverComicId}/thumbnail` : null)
              }
              compact={compact}
            />
          ))}
          {comics.map((comic) => (
            <ComicListRow
              key={comic.id}
              record={comic}
              isAdmin={isAdmin}
              orderedIds={orderedIds}
              compact={compact}
              onContextMenu={handleContextMenu}
            />
          ))}
        </div>
      ) : (
        /* Grid view: responsive cover grid. */
        <div
          className={cn(
            'grid gap-x-5 gap-y-6',
            compact ? COMPACT_COLS : COMFORTABLE_COLS,
          )}
        >
          {folders.map((folder) => (
            <div key={folder.id} className="h-full">
              <FolderCard folder={folder} />
            </div>
          ))}

          {groups.map((group) => (
            <div key={group.key} className="h-full">
              <GroupCard
                title={group.name || group.label || group.key}
                count={group.count}
                badgeLabel={badgeLabel}
                thumbnailUrl={
                  group.thumbnailUrl ||
                  (group.coverComicId ? `/api/comics/${group.coverComicId}/thumbnail` : null)
                }
                href={group.href || `${groupHrefPrefix}${encodeURIComponent(group.key)}`}
                metaLabel={badgeLabel === 'Volume' ? group.label : undefined}
              />
            </div>
          ))}

          {comics.map((comic) => (
            <div key={comic.id} className="h-full">
              <ComicCard
                record={comic}
                isAdmin={isAdmin}
                orderedIds={orderedIds}
                onContextMenu={handleContextMenu}
              />
            </div>
          ))}
        </div>
      )}

      {/* Infinite Scroll Sentinel indicator */}
      {fetchNextPage && hasNextPage && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          {isFetchingNextPage && <Loader2 className="h-6 w-6 animate-spin text-primary" />}
        </div>
      )}

      {/* Programmatic Context Menu Component */}
      <ContextMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        x={menuPos.x}
        y={menuPos.y}
        targetComic={menuTargetComic}
      />
    </div>
  );
}

/** A single navigable row for folders/series groups in list view. */
function ListNavRow({
  to,
  title,
  meta,
  thumbnailUrl,
  compact,
}: {
  to: string;
  title: string;
  meta: string;
  thumbnailUrl: string | null;
  compact: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(to)}
      className={cn(
        'flex items-center gap-3 rounded-md px-2 cursor-pointer select-none transition-colors hover:bg-muted/50',
        compact ? 'py-1.5' : 'py-2.5',
      )}
    >
      <div className="h-12 w-9 shrink-0 overflow-hidden rounded-sm bg-secondary">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <span className="truncate text-[13px] font-medium text-foreground">{title}</span>
        <div className="text-[11px] text-section">{meta}</div>
      </div>
    </div>
  );
}
