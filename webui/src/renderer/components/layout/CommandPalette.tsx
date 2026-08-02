import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Search,
  Library as LibraryIcon,
  FolderOpen,
  Tag,
  Settings,
  Users,
  LogIn,
} from 'lucide-react';
import {
  buildPaletteResults,
  NAVBAR_SEARCH_INPUT_ID,
  type PaletteAction,
  type PaletteItem,
} from './commandPaletteHelpers';

/**
 * Global ⌘K / Ctrl+K command palette.
 *
 * Searches book titles server-side (debounced) and filters the cached
 * collections/folders/tags lists client-side, sharing the Sidebar's query
 * cache. Also owns the global `/` shortcut that focuses the navbar search.
 * No-ops entirely while the reader is open — the reader owns the keyboard.
 */
export default function CommandPalette() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const isReader = location.pathname.startsWith('/read');

  // Keep the latest reader state in a ref so the keydown listener can be
  // registered exactly once for the component's lifetime.
  const isReaderRef = useRef(isReader);
  useEffect(() => {
    isReaderRef.current = isReader;
  }, [isReader]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isReaderRef.current) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target;
        const isEditable =
          target instanceof HTMLElement &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
        if (isEditable) return;
        const searchInput = document.getElementById(NAVBAR_SEARCH_INPUT_ID);
        if (searchInput instanceof HTMLInputElement) {
          e.preventDefault();
          searchInput.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Debounce the book title search
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(handler);
  }, [query]);

  const { data: bookResults } = useQuery({
    queryKey: ['palette-books', debouncedQuery],
    queryFn: () => api.fetchComics({ search: debouncedQuery, sortBy: 'title', limit: 8 }),
    enabled: open && debouncedQuery.length > 0,
    staleTime: 30_000,
  });

  // Same query keys as Sidebar so the cached lists are shared
  const { data: libraries = [] } = useQuery({
    queryKey: ['libraries'],
    queryFn: () => api.fetchLibraries(),
    enabled: open,
  });
  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: api.fetchFolders,
    enabled: open,
  });
  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: api.fetchTags,
    enabled: open,
  });
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
    staleTime: 30_000,
  });

  const actions = useMemo<PaletteAction[]>(() => {
    const isAuthenticated = session?.authenticated ?? false;
    const isAdmin = session?.user?.isAdmin === true;
    const list: PaletteAction[] = [{ id: 'settings', label: 'Settings', to: '/settings' }];
    if (isAdmin) list.push({ id: 'users', label: 'User management', to: '/users' });
    if (!isAuthenticated) list.push({ id: 'login', label: 'Sign in', to: '/login' });
    return list;
  }, [session]);

  const results = useMemo(
    () =>
      buildPaletteResults(query, {
        books: bookResults?.records ?? [],
        collections: libraries,
        folders,
        tags,
        actions,
      }),
    [query, bookResults, libraries, folders, tags, actions],
  );

  // Reset the highlight whenever the result set changes
  useEffect(() => {
    setHighlighted(0);
  }, [query, results.length]);

  // Keep the highlighted row visible while arrowing through the list
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-highlighted="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, results]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  }, []);

  const activate = useCallback(
    (item: PaletteItem) => {
      handleOpenChange(false);
      navigate(item.to);
    },
    [navigate, handleOpenChange],
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[highlighted];
      if (item) activate(item);
    }
  };

  if (isReader) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="top-24 max-w-lg translate-y-0 gap-0 overflow-hidden rounded-lg border-border bg-card p-0 [&>button]:hidden"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="relative border-b border-border">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            type="text"
            placeholder="Search books, collections, folders, tags..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            className="h-11 rounded-none border-0 bg-transparent pl-10 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No results</div>
          ) : (
            results.map((item, index) => (
              <React.Fragment key={item.key}>
                {(index === 0 || results[index - 1].group !== item.group) && (
                  <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    {item.group}
                  </div>
                )}
                <button
                  type="button"
                  data-highlighted={index === highlighted}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => activate(item)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground',
                    index === highlighted && 'bg-muted',
                  )}
                >
                  <PaletteItemIcon item={item} />
                  <span className="truncate">{item.label}</span>
                </button>
              </React.Fragment>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Book rows get a thumbnail; every other group gets a small muted icon. */
function PaletteItemIcon({ item }: { item: PaletteItem }) {
  if (item.group === 'Books' && item.comicId !== undefined) {
    return (
      <img
        src={api.thumbnailUrl(item.comicId, 48)}
        alt=""
        loading="lazy"
        className="h-8 w-6 shrink-0 rounded-sm bg-muted object-cover"
      />
    );
  }
  const className = 'h-4 w-4 shrink-0 text-muted-foreground';
  switch (item.group) {
    case 'Collections':
      return <LibraryIcon className={className} />;
    case 'Folders':
      return <FolderOpen className={className} />;
    case 'Tags':
      return <Tag className={className} />;
    default:
      if (item.key === 'action-users') return <Users className={className} />;
      if (item.key === 'action-login') return <LogIn className={className} />;
      return <Settings className={className} />;
  }
}
