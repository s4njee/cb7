import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useUiStore } from '@/store/uiStore';
import { useInfiniteComics } from '@/hooks/useInfiniteComics';
import * as api from '@/lib/api';
import { Library, SearchX, FolderPlus, Upload, Users, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ContinueShelf from '@/components/library/ContinueShelf';
import EmptyState from '@/components/library/EmptyState';
import ActiveFilterChips from '@/components/library/ActiveFilterChips';
import RecentlyAddedShelf from '@/components/library/RecentlyAddedShelf';
import FilterStrips from '@/components/library/FilterStrips';
import LibraryGrid from '@/components/library/LibraryGrid';
import ReadingStats from '@/components/library/ReadingStats';
import SelectionBar from '@/components/library/SelectionBar';

export default function AllPage() {
  const {
    mediaType,
    sortBy,
    sortOrder,
    search,
    fileExt,
    readStatus,
    favoritesOnly,
    missingOnly,
  } = useUiStore();

  const isSearchActive = search.trim() !== '';

  // Session + admin, for first-run onboarding on an empty library.
  const { data: session } = useQuery({ queryKey: ['session'], queryFn: api.getSession });
  const isAdmin = session?.user?.isAdmin === true;
  const openAdminPanel = useUiStore((s) => s.openAdminPanel);
  const resetFilters = useUiStore((s) => s.resetFilters);

  // "Filters" exclude sort/search: sort just orders, search switches the view.
  const hasActiveFilters =
    mediaType !== '' || fileExt !== '' || readStatus !== '' || favoritesOnly || missingOnly;

  // 1. Query for standard infinite comics list (when search is empty)
  const infiniteQuery = useInfiniteComics({
    mediaType: mediaType || undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortOrder || undefined,
    fileExt: fileExt || undefined,
    readStatus: readStatus || undefined,
    favoritesOnly: favoritesOnly || undefined,
    missingOnly: missingOnly || undefined,
  });

  // Flatten the infinite query pages into a single flat array of WebComicRecord.
  // Memoized so the grid's memoized cards keep stable props between re-renders.
  const infiniteData = infiniteQuery.data;
  const comics = useMemo(
    () => infiniteData?.pages.flatMap((page) => page.records) ?? [],
    [infiniteData],
  );

  // 2. Query for global series-grouped browse list (when search is active)
  const { data: searchGroupsResponse, isLoading: searchLoading } = useQuery({
    queryKey: ['browse', 'series', { search }],
    queryFn: () => api.fetchBrowseSeries({ search }),
    enabled: isSearchActive,
    staleTime: 5000, // Refresh search results reasonably fast
  });

  const searchGroups = searchGroupsResponse?.groups || [];

  // 3. Hybrid (keyword + semantic) search inside the text of e-books.
  const navigate = useNavigate();
  const { data: insideResp } = useQuery({
    queryKey: ['search-inside', { search }],
    queryFn: () => api.searchInside(search),
    enabled: isSearchActive,
    staleTime: 5000,
  });
  const inside = insideResp?.results || [];

  // Distinct empty states (P3-2): an empty library gets onboarding CTAs for
  // admins; an active filter with no matches gets a "clear" action — never the
  // same empty illustration.
  const emptyLibraryContent = isAdmin ? (
    <EmptyState
      icon={<Library className="h-8 w-8 text-faint" />}
      title="Your library is empty"
      description="Point CB8 at the folders where your comics and books live, or upload them directly. Everything stays readable offline."
      actions={
        <>
          <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" onClick={() => openAdminPanel('add-path')}>
            <FolderPlus className="h-4 w-4 mr-1.5" /> Add a folder
          </Button>
          <Button size="sm" variant="outline" className="border-border" onClick={() => openAdminPanel('upload')}>
            <Upload className="h-4 w-4 mr-1.5" /> Upload files
          </Button>
          <Button size="sm" variant="outline" className="border-border" onClick={() => navigate('/settings')}>
            <Users className="h-4 w-4 mr-1.5" /> Enable guest access
          </Button>
        </>
      }
    />
  ) : (
    <EmptyState
      icon={<Library className="h-8 w-8 text-faint" />}
      title="Your library is empty"
      description="Ask an admin to add folders or upload files."
    />
  );

  const standardEmptyContent = hasActiveFilters ? (
    <EmptyState
      icon={<SearchX className="h-8 w-8 text-faint" />}
      title="No books match these filters"
      description="Try another media type or status, or clear the filters to see the whole library."
      actions={
        <Button size="sm" variant="outline" className="border-border" onClick={resetFilters}>
          Clear filters
        </Button>
      }
    />
  ) : (
    emptyLibraryContent
  );

  const catalogErrorContent = (
    <EmptyState
      icon={<AlertCircle className="h-8 w-8 text-faint" />}
      title="Couldn't load the library"
      description="The catalog request failed. Check that the server is running and try again."
      actions={
        <Button size="sm" variant="outline" className="border-border" onClick={() => void infiniteQuery.refetch()}>
          Try again
        </Button>
      }
    />
  );

  const searchEmptyContent = (
    <EmptyState
      icon={<SearchX className="h-8 w-8 text-faint" />}
      title="No series match your search"
      description={`Nothing in the library matches "${search}".`}
      actions={
        <Button size="sm" variant="outline" className="border-border" onClick={resetFilters}>
          Clear search
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col min-h-full">
      {isSearchActive ? (
        // Search View: Series-grouped Browse list
        <div className="flex-1 flex flex-col">
          <div className="catalog-frame-head px-4 md:px-10 py-4 border-b border-header-rule bg-card/10 select-none">
            <h2 className="eyebrow">
              Search Results for: <span className="text-primary italic lowercase font-normal">"{search}"</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-2">
              Found {searchGroupsResponse?.totalCount ?? 0} series match{searchGroupsResponse?.totalCount === 1 ? '' : 'es'}.
            </p>
          </div>
          <ActiveFilterChips />
          {inside.length > 0 && (
            <div className="px-4 md:px-10 py-4 border-b border-header-rule select-none">
              <h3 className="eyebrow mb-3">
                Inside your books{' '}
                <span className="text-xs font-normal normal-case text-muted-foreground/70">({inside.length})</span>
              </h3>
              <ul className="space-y-2 max-h-[min(70vh,560px)] overflow-y-auto overscroll-contain">
                {inside.map((hit, i) => (
                  <li key={`${hit.comicId}-${i}`}>
                    <button
                      onClick={() => navigate(`/read/${hit.comicId}`)}
                      className="w-full text-left rounded-md border border-border bg-card/30 hover:bg-card/60 transition-colors p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{hit.book}</span>
                        {hit.chapter && (
                          <span className="text-xs text-muted-foreground truncate">· {hit.chapter}</span>
                        )}
                        <span
                          title={
                            hit.via === 'both'
                              ? 'Matched by keyword and semantic search'
                              : hit.via === 'semantic'
                                ? 'Matched by meaning (vector similarity)'
                                : 'Matched by keyword (full-text)'
                          }
                          className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            hit.via === 'both'
                              ? 'bg-primary/20 text-primary'
                              : hit.via === 'semantic'
                                ? 'bg-primary/10 text-primary'
                                : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {hit.via}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">…{hit.snippet}…</p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex-1">
            <LibraryGrid
              groups={searchGroups}
              badgeLabel="Series"
              groupHrefPrefix="/browse/series/"
              isLoading={searchLoading}
              emptyContent={searchEmptyContent}
            />
          </div>
        </div>
      ) : (
        // Standard View: Reading stats + Shelf + Filter Strips + Paginated Grid
        <div className="flex-1 flex flex-col">
          {/* Per-user reading summary (P1-7) — hidden for guests / no activity */}
          <ReadingStats />

          {/* Continue reading shelf */}
          <ContinueShelf />

          {/* Library controls stay above the shelves so they are easy to reach. */}
          <FilterStrips />

          {/* Recently added shelf (P3-2) — "new on disk", not "recently read". */}
          <RecentlyAddedShelf />

          {/* Removable chips for active filters (P3-1) */}
          <ActiveFilterChips />

          {/* Paginated Infinite Scroll grid */}
          <div className="flex-1">
            <LibraryGrid
              comics={comics}
              isLoading={infiniteQuery.isLoading}
              fetchNextPage={infiniteQuery.fetchNextPage}
              hasNextPage={infiniteQuery.hasNextPage}
              isFetchingNextPage={infiniteQuery.isFetchingNextPage}
              emptyContent={infiniteQuery.isError ? catalogErrorContent : standardEmptyContent}
            />
          </div>
        </div>
      )}

      {/* Floating bulk selection actions bar */}
      <SelectionBar matchingScope={{}} />
    </div>
  );
}
