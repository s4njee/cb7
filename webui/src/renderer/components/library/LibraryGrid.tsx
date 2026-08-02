import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Folder, WebComicRecord } from '@/lib/api';
import ComicCard from './ComicCard';
import FolderCard from './FolderCard';
import GroupCard from './GroupCard';
import ContextMenu from './ContextMenu';
import * as api from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { useSelectionStore } from '@/store/selectionStore';

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
  
  // Infinite scroll properties
  fetchNextPage?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
}

export default function LibraryGrid({
  comics = [],
  folders = [],
  groups = [],
  badgeLabel = '',
  groupHrefPrefix = '',
  isLoading = false,
  emptyMessage = 'No items found in this section.',
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
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm font-medium select-none italic text-center px-4">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="px-4 md:px-10 py-4 select-none">
      {/* 3. Core Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-x-5 gap-y-6">
        {/* Render Folder Cards */}
        {folders.map((folder) => (
          <div key={folder.id} className="h-full">
            <FolderCard folder={folder} />
          </div>
        ))}

        {/* Render Group Cards */}
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

        {/* Render Comic Cards */}
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
