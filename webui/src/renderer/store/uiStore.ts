import { create } from 'zustand';

/**
 * @module
 * Global UI State (Zustand)
 *
 * Architecture overview for Junior Devs:
 * Holds app-wide UI state that must persist as the user navigates between pages
 * but isn't server data — the active media-type/sort/read-status filters, the
 * search box text, which side tab panel is open, and the color theme. Server data
 * does NOT belong here; that lives in React Query. Use this only for view state.
 */

export type MediaTypeFilter = '' | 'comic' | 'book';
export type SortByFilter = 'title' | 'dateAdded' | 'fileSize' | 'pageCount' | 'lastRead';
export type SortOrderFilter = 'asc' | 'desc';
export type ReadStatusFilter = '' | 'unread' | 'in-progress' | 'completed';
export type TabPanelType = null | 'browse';
export type ThemeType = 'red' | 'blue' | 'green' | 'purple' | 'orange' | 'teal';

/** Default direction when the user picks a sort field (newest-first for dates). */
export function defaultSortOrderFor(sortBy: SortByFilter): SortOrderFilter {
  return sortBy === 'dateAdded' || sortBy === 'lastRead' ? 'desc' : 'asc';
}

interface UiState {
  mediaType: MediaTypeFilter;
  sortBy: SortByFilter;
  sortOrder: SortOrderFilter;
  search: string;
  fileExt: string;
  readStatus: ReadStatusFilter;
  favoritesOnly: boolean;
  tabPanel: TabPanelType;
  theme: ThemeType;
  setMediaType: (type: MediaTypeFilter) => void;
  setSortBy: (sortBy: SortByFilter) => void;
  setSortOrder: (sortOrder: SortOrderFilter) => void;
  setSearch: (search: string) => void;
  setFileExt: (fileExt: string) => void;
  setReadStatus: (status: ReadStatusFilter) => void;
  setFavoritesOnly: (favOnly: boolean) => void;
  setTabPanel: (panel: TabPanelType) => void;
  setTheme: (theme: ThemeType) => void;
  resetFilters: () => void;
}

const THEME_KEY = 'cb8.theme';
const DEFAULT_THEME: ThemeType = 'red';

function getInitialTheme(): ThemeType {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    const allowed: ThemeType[] = ['red', 'blue', 'green', 'purple', 'orange', 'teal'];
    if (stored && allowed.includes(stored as ThemeType)) {
      // Ensure attribute is set on mount
      document.documentElement.setAttribute('data-theme', stored);
      return stored as ThemeType;
    }
  } catch {}
  document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
  return DEFAULT_THEME;
}

export const useUiStore = create<UiState>((set) => ({
  mediaType: '',
  sortBy: 'dateAdded',
  sortOrder: 'desc',
  search: '',
  fileExt: '',
  readStatus: '',
  favoritesOnly: false,
  tabPanel: null,
  theme: getInitialTheme(),

  setMediaType: (mediaType) => set({ mediaType }),
  // Changing the field also resets direction to that field's sensible default
  // (e.g. Recent → newest first) so the order dropdown doesn't leave a stale
  // "A→Z" applied to a date sort.
  setSortBy: (sortBy) => set({ sortBy, sortOrder: defaultSortOrderFor(sortBy) }),
  setSortOrder: (sortOrder) => set({ sortOrder }),
  setSearch: (search) => set({ search }),
  setFileExt: (fileExt) => set({ fileExt }),
  setReadStatus: (readStatus) => set({ readStatus }),
  setFavoritesOnly: (favoritesOnly) => set({ favoritesOnly }),
  setTabPanel: (tabPanel) => set({ tabPanel }),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  resetFilters: () =>
    set({
      mediaType: '',
      sortBy: 'dateAdded',
      sortOrder: 'desc',
      search: '',
      fileExt: '',
      readStatus: '',
      favoritesOnly: false,
    }),
}));
