import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { errorMessage } from '@/lib/errors';
import { useUiStore, SortByFilter } from '@/store/uiStore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { showToast } from '@/hooks/useToast';
import { Search, Plus, SlidersHorizontal, ChevronDown, Settings, Users, LogOut, Upload, FolderInput } from 'lucide-react';
import NavbarThemeMenu from './NavbarThemeMenu';
import { NAVBAR_SEARCH_INPUT_ID } from './commandPaletteHelpers';

const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

/** First 1-2 initials for the avatar chip, e.g. "jane doe" → "JD", "admin" → "AD". */
function userInitials(username: string): string {
  const words = username.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return username.trim().slice(0, 2).toUpperCase() || '?';
}

interface NavbarProps {
  onOpenSortSheet: () => void;
  onOpenAdminModal: (panel: string) => void;
}

export default function Navbar({ onOpenSortSheet, onOpenAdminModal }: NavbarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
    staleTime: 30_000,
  });

  const isAuthenticated = session?.authenticated ?? false;
  const isAdmin = session?.user?.isAdmin === true;
  const username = session?.user?.username ?? '';

  const handleSignOut = async () => {
    try {
      await api.logout();
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      // Per-user catalog overlays (progress, favorites) go away with the
      // session, so drop the cached library data too.
      void invalidateLibraryQueries(queryClient);
      showToast('Signed out successfully');
    } catch (err) {
      showToast(errorMessage(err, 'Failed to sign out'));
    }
  };

  const {
    mediaType,
    sortBy,
    search,
    theme,
    setMediaType,
    setSortBy,
    setSearch,
    setTheme,
  } = useUiStore();

  const [localSearch, setLocalSearch] = useState(search);

  // Sync local search input with global search state if it changes externally
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  // Debounce local search updates to store
  useEffect(() => {
    const handler = setTimeout(() => {
      setSearch(localSearch);
    }, 300);
    return () => clearTimeout(handler);
  }, [localSearch, setSearch]);

  return (
    <header className="sticky top-0 z-40 w-full h-13 bg-background/80 backdrop-blur-md px-4 flex items-center justify-between gap-4">
      {/* Brand Logo */}
      <a href="#/" className="text-xl font-bold tracking-wider hover:opacity-90 shrink-0">
        <span className="text-foreground">CB</span>
        <span className="text-primary">8</span>
      </a>

      {/* Search Input */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          id={NAVBAR_SEARCH_INPUT_ID}
          type="search"
          placeholder="Search..."
          className="pl-9 md:pr-14 bg-secondary border-border h-9 w-full"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 select-none items-center rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground md:inline-flex">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </div>

      {/* Desktop Filters / Actions */}
      <div className="flex items-center gap-3">
        {/* Mobile Sort Trigger */}
        <Button
          variant="outline"
          size="icon"
          onClick={onOpenSortSheet}
          className="md:hidden h-9 w-9 bg-secondary border-border"
          aria-label="Sort options"
        >
          <SlidersHorizontal className="h-4.5 w-4.5" />
        </Button>

        {/* Desktop Sort Select */}
        <div className="hidden md:block w-40">
          <Select
            value={sortBy}
            onValueChange={(val) => setSortBy(val as SortByFilter)}
          >
            <SelectTrigger className="h-9 bg-secondary border-border">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent className="bg-secondary border-border">
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="dateAdded">Date added</SelectItem>
              <SelectItem value="fileSize">File size</SelectItem>
              <SelectItem value="pageCount">Pages</SelectItem>
              <SelectItem value="lastRead">Recently Read</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Media Toggle Segmented Control (Desktop only) */}
        <div className="hidden md:flex bg-secondary border border-border rounded-full p-0.5 h-9 items-center">
          <Button
            variant={mediaType === '' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMediaType('')}
            className="h-8 text-xs px-3"
          >
            All
          </Button>
          <Button
            variant={mediaType === 'comic' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMediaType('comic')}
            className="h-8 text-xs px-3"
          >
            Comics
          </Button>
          <Button
            variant={mediaType === 'book' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMediaType('book')}
            className="h-8 text-xs px-3"
          >
            Books
          </Button>
        </div>

        {/* Admin actions & tools */}
        <div className="flex items-center gap-1.5">
          {/* Add-content menu — upload or ingest a server path (admin only). */}
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 bg-secondary border-border hover:bg-muted"
                  aria-label="Add content"
                >
                  <Plus className="h-4.5 w-4.5 text-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-secondary border-border w-48">
                <DropdownMenuItem
                  onClick={() => onOpenAdminModal('upload')}
                  className="gap-2 cursor-pointer text-foreground focus:bg-muted focus:text-foreground"
                >
                  <Upload className="h-4 w-4" />
                  <span>Upload files</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onOpenAdminModal('add-path')}
                  className="gap-2 cursor-pointer text-foreground focus:bg-muted focus:text-foreground"
                >
                  <FolderInput className="h-4 w-4" />
                  <span>Add from server path</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* User chip (signed in) or sign-in button */}
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-9 px-2 gap-1.5 bg-secondary border-border hover:bg-muted"
                  aria-label="Account menu"
                >
                  <span className="h-6 w-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                    {userInitials(username)}
                  </span>
                  <span className="hidden md:inline text-sm font-medium max-w-28 truncate">
                    {username}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-secondary border-border w-48">
                <DropdownMenuItem
                  onClick={() => navigate('/settings')}
                  className="gap-2 cursor-pointer text-foreground focus:bg-muted focus:text-foreground"
                >
                  <Settings className="h-4 w-4" />
                  <span>Settings</span>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem
                    onClick={() => navigate('/users')}
                    className="gap-2 cursor-pointer text-foreground focus:bg-muted focus:text-foreground"
                  >
                    <Users className="h-4 w-4" />
                    <span>User management</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="gap-2 cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/login')}
              className="h-9 px-3 bg-secondary border-border hover:bg-muted"
            >
              Sign in
            </Button>
          )}

          <NavbarThemeMenu theme={theme} onThemeChange={setTheme} />
        </div>
      </div>
    </header>
  );
}
