import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { errorMessage } from '@/lib/errors';
import { useUiStore } from '@/store/uiStore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { showToast } from '@/hooks/useToast';
import { Search, Plus, Settings, Users, LogOut, Upload, FolderInput, Library, FolderPlus } from 'lucide-react';
import NavbarThemeMenu from './NavbarThemeMenu';
import { NAVBAR_SEARCH_INPUT_ID } from './commandPaletteHelpers';
import { cn } from '@/lib/utils';

/** First 1-2 initials for the avatar chip, e.g. "jane doe" → "JD". */
function userInitials(username: string): string {
  const words = username.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return username.trim().slice(0, 2).toUpperCase() || '?';
}

/**
 * The Folio top header — the single navigation surface on every width (the old
 * Navbar + Sidebar + mobile TabBar collapse into this). Serif wordmark, inline
 * text tabs with an accent underline, a search field, and the account cluster.
 */
interface FolioTab {
  label: string;
  to: string;
  match: (path: string) => boolean;
}

// Each header tab maps to a route; `match` also lights the tab up for the
// detail routes that live under it (a collection under Collections, etc.).
const TABS: FolioTab[] = [
  { label: 'Library', to: '/', match: (p) => p === '/' || p === '' },
  { label: 'Reading now', to: '/continue', match: (p) => p.startsWith('/continue') },
  { label: 'Finished', to: '/finished', match: (p) => p.startsWith('/finished') },
  {
    label: 'Collections',
    to: '/collections',
    match: (p) => p.startsWith('/collections') || p.startsWith('/library'),
  },
  {
    label: 'Folders',
    to: '/folders',
    match: (p) => p.startsWith('/folders') || p.startsWith('/folder'),
  },
  { label: 'Tags', to: '/tags', match: (p) => p.startsWith('/tags') || p.startsWith('/tag') },
];

interface FolioHeaderProps {
  onOpenAdminModal: (panel: string) => void;
}

export default function FolioHeader({ onOpenAdminModal }: FolioHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
    staleTime: 30_000,
  });
  const isAuthenticated = session?.authenticated ?? false;
  const isAdmin = session?.user?.isAdmin === true;
  const username = session?.user?.username ?? '';

  const { search, theme, setSearch, setTheme } = useUiStore();
  const [localSearch, setLocalSearch] = useState(search);
  useEffect(() => setLocalSearch(search), [search]);
  useEffect(() => {
    const handler = setTimeout(() => setSearch(localSearch), 300);
    return () => clearTimeout(handler);
  }, [localSearch, setSearch]);

  const handleSignOut = async () => {
    try {
      await api.logout();
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      void invalidateLibraryQueries(queryClient);
      showToast('Signed out successfully');
    } catch (err) {
      showToast(errorMessage(err, 'Failed to sign out'));
    }
  };

  const tabs = (
    <nav className="flex items-center gap-5 whitespace-nowrap">
      {TABS.map((tab) => {
        const active = tab.match(location.pathname);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={cn(
              'text-[13.5px] pb-0.5 border-b transition-colors',
              active
                ? 'text-foreground border-primary'
                : 'text-muted-foreground border-transparent hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );

  const searchField = (
    <div className="relative w-full md:w-64">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-placeholder" />
      <Input
        id={NAVBAR_SEARCH_INPUT_ID}
        type="search"
        placeholder="Search titles, authors…"
        className="pl-9 bg-card border-border h-9 w-full text-[13px] placeholder:text-placeholder"
        value={localSearch}
        onChange={(e) => setLocalSearch(e.target.value)}
      />
    </div>
  );

  const accountCluster = (
    <div className="flex items-center gap-2 shrink-0">
      {isAdmin && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-card"
              aria-label="Add content"
            >
              <Plus className="h-4.5 w-4.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover border-popover-border w-48">
            <DropdownMenuItem
              onClick={() => onOpenAdminModal('upload')}
              className="gap-2 cursor-pointer focus:bg-muted"
            >
              <Upload className="h-4 w-4" />
              <span>Upload files</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onOpenAdminModal('add-path')}
              className="gap-2 cursor-pointer focus:bg-muted"
            >
              <FolderInput className="h-4 w-4" />
              <span>Add from server path</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={() => onOpenAdminModal('create-collection')}
              className="gap-2 cursor-pointer focus:bg-muted"
            >
              <Library className="h-4 w-4" />
              <span>New collection</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onOpenAdminModal('create-folder')}
              className="gap-2 cursor-pointer focus:bg-muted"
            >
              <FolderPlus className="h-4 w-4" />
              <span>New folder</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <NavbarThemeMenu theme={theme} onThemeChange={setTheme} />

      {isAuthenticated ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="h-[30px] w-[30px] rounded-full bg-avatar text-primary text-[11px] font-semibold flex items-center justify-center shrink-0 hover:opacity-90"
              aria-label="Account menu"
            >
              {userInitials(username)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover border-popover-border w-48">
            <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{username}</div>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={() => navigate('/settings')}
              className="gap-2 cursor-pointer focus:bg-muted"
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem
                onClick={() => navigate('/users')}
                className="gap-2 cursor-pointer focus:bg-muted"
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
          className="h-9 px-3"
        >
          Sign in
        </Button>
      )}
    </div>
  );

  const wordmark = (
    <Link to="/" className="font-sans text-[21px] font-semibold tracking-[0.01em] hover:opacity-90 shrink-0">
      <span className="text-foreground">CB</span>
      <span className="text-primary">8</span>
    </Link>
  );

  return (
    <header className="w-full border-b border-header-rule bg-background">
      {/* Desktop: everything on one row */}
      <div className="hidden md:flex items-center gap-7 px-10 h-[68px]">
        {wordmark}
        {tabs}
        <div className="ml-auto flex items-center gap-3">
          {searchField}
          {accountCluster}
        </div>
      </div>

      {/* Mobile: wordmark + account, then search, then a scrollable tab strip */}
      <div className="md:hidden px-4 pt-2.5 pb-2 flex flex-col gap-2.5">
        <div className="flex items-center">
          {wordmark}
          <div className="ml-auto">{accountCluster}</div>
        </div>
        {searchField}
        <div className="-mx-4 px-4 overflow-x-auto no-scrollbar">{tabs}</div>
      </div>
    </header>
  );
}
