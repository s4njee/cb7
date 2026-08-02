import { QueryClient } from '@tanstack/react-query';

/**
 * @module
 * React Query Client and Library Cache Invalidation
 *
 * Architecture overview for Junior Devs:
 * All server data in the SPA is fetched and cached through React Query. This file
 * creates the single shared `queryClient` (with the app's default caching policy:
 * 30s stale time, no refetch on window focus, one retry) and exports
 * `invalidateLibraryQueries`, the one helper to call after a mutation that
 * changes the catalog.
 *
 * Why the big list below: any write (importing, tagging, deleting, updating
 * progress) can affect many different views — the grid, folders, series rollups,
 * continue/recent shelves, etc. Rather than invalidate each by hand, this matches
 * all library-related query keys in one pass so the UI refetches what's stale.
 * If you add a new library-related query key, add it here too.
 */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Invalidate every library-related query so affected views refetch.
 * @param client The React Query client (usually the shared `queryClient`).
 * @returns A promise that resolves once invalidation is queued.
 */
export function invalidateLibraryQueries(client: QueryClient): Promise<void> {
  return client.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return [
        'comics',
        'comic',
        'folders',
        'libraries',
        'tags',
        'browse',
        'series',
        'folder-series',
        'folder-volumes',
        'folder-chapters',
        'folder-volume-comics-flat',
        'folder-volume-comics-unnumbered',
        'folder-chapter-comics',
        'browse-volumes',
        'browse-chapters',
        'browse-volume-comics-flat',
        'browse-volume-comics-unnumbered',
        'browse-chapter-comics',
        'continue-reading',
        'recently-read',
        'library-comics',
        'tag-comics',
      ].includes(String(key));
    },
  });
}
