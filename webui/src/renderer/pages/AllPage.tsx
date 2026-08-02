import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useUiStore } from '@/store/uiStore';
import { useInfiniteComics } from '@/hooks/useInfiniteComics';
import * as api from '@/lib/api';
import ContinueShelf from '@/components/library/ContinueShelf';
import FilterStrips from '@/components/library/FilterStrips';
import LibraryGrid from '@/components/library/LibraryGrid';
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
  } = useUiStore();

  const isSearchActive = search.trim() !== '';

  // 1. Query for standard infinite comics list (when search is empty)
  const infiniteQuery = useInfiniteComics({
    mediaType: mediaType || undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortOrder || undefined,
    fileExt: fileExt || undefined,
    readStatus: readStatus || undefined,
    favoritesOnly: favoritesOnly || undefined,
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

  return (
    <div className="flex flex-col min-h-full">
      {isSearchActive ? (
        // Search View: Series-grouped Browse list
        <div className="flex-1 flex flex-col">
          <div className="p-4 border-b border-border bg-card/10 select-none">
            <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">
              Search Results for: <span className="text-primary italic lowercase font-normal">"{search}"</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Found {searchGroupsResponse?.totalCount ?? 0} series match{searchGroupsResponse?.totalCount === 1 ? '' : 'es'}.
            </p>
          </div>
          {inside.length > 0 && (
            <div className="p-4 border-b border-border select-none">
              <h3 className="text-sm font-bold tracking-wide text-muted-foreground uppercase mb-3">
                Inside your books{' '}
                <span className="text-xs font-normal normal-case text-muted-foreground/70">({inside.length})</span>
              </h3>
              <ul className="space-y-2">
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
              emptyMessage="No matching series found for your query."
            />
          </div>
        </div>
      ) : (
        // Standard View: Shelf + Filter Strips + Paginated Grid
        <div className="flex-1 flex flex-col">
          {/* Continue reading shelf */}
          <ContinueShelf />

          {/* Core filters bar */}
          <FilterStrips />

          {/* Paginated Infinite Scroll grid */}
          <div className="flex-1">
            <LibraryGrid
              comics={comics}
              isLoading={infiniteQuery.isLoading}
              fetchNextPage={infiniteQuery.fetchNextPage}
              hasNextPage={infiniteQuery.hasNextPage}
              isFetchingNextPage={infiniteQuery.isFetchingNextPage}
              emptyMessage="No comics or books found matching the selected filters."
            />
          </div>
        </div>
      )}

      {/* Floating bulk selection actions bar */}
      <SelectionBar />
    </div>
  );
}
