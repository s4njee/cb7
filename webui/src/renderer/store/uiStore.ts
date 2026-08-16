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
export type ViewMode = 'grid' | 'list';
export type GridDensity = 'compact' | 'comfortable';

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
  /** Show only records whose file is missing from disk (P1-8). */
  missingOnly: boolean;
  tabPanel: TabPanelType;
  theme: ThemeType;
  /** Which admin content panel (if any) is open in the AdminModal. */
  adminPanel: string | null;
  /** Library presentation: card grid vs compact list rows. */
  viewMode: ViewMode;
  /** Cover density; affects grid columns / list row height. */
  density: GridDensity;
  setMediaType: (type: MediaTypeFilter) => void;
  setSortBy: (sortBy: SortByFilter) => void;
  setSortOrder: (sortOrder: SortOrderFilter) => void;
  setSearch: (search: string) => void;
  setFileExt: (fileExt: string) => void;
  setReadStatus: (status: ReadStatusFilter) => void;
  setFavoritesOnly: (favOnly: boolean) => void;
  setMissingOnly: (missingOnly: boolean) => void;
  setTabPanel: (panel: TabPanelType) => void;
  setTheme: (theme: ThemeType) => void;
  openAdminPanel: (panel: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setDensity: (density: GridDensity) => void;
  resetFilters: () => void;
}

const THEME_KEY = 'cb8.theme';
const DEFAULT_THEME: ThemeType = 'red';

// View preferences persist per device class so a phone preference (e.g. list)
// does not force an overly sparse desktop layout or vice versa.
const VIEW_PREFS_KEY = 'cb8.view';

function deviceClass(): 'phone' | 'desktop' {
  return typeof window !== 'undefined' && window.innerWidth < 768 ? 'phone' : 'desktop';
}

function loadViewPrefs(): { viewMode: ViewMode; density: GridDensity } {
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) ?? 'null') as
      | Partial<Record<'phone' | 'desktop', { viewMode?: ViewMode; density?: GridDensity }>>
      | null;
    const prefs = stored?.[deviceClass()];
    return {
      viewMode: prefs?.viewMode === 'list' ? 'list' : 'grid',
      density: prefs?.density === 'compact' ? 'compact' : 'comfortable',
    };
  } catch {
    return { viewMode: 'grid', density: 'comfortable' };
  }
}

function persistViewPrefs(viewMode: ViewMode, density: GridDensity): void {
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) ?? 'null') as
      | Partial<Record<'phone' | 'desktop', unknown>>
      | null;
    const next = { ...(stored ?? {}), [deviceClass()]: { viewMode, density } };
    localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* best-effort persistence */
  }
}

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

const initialViewPrefs = loadViewPrefs();

export const useUiStore = create<UiState>((set) => ({
  mediaType: '',
  sortBy: 'dateAdded',
  sortOrder: 'desc',
  search: '',
  fileExt: '',
  readStatus: '',
  favoritesOnly: false,
  missingOnly: false,
  tabPanel: null,
  theme: getInitialTheme(),
  adminPanel: null,
  viewMode: initialViewPrefs.viewMode,
  density: initialViewPrefs.density,

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
  setMissingOnly: (missingOnly) => set({ missingOnly }),
  setTabPanel: (tabPanel) => set({ tabPanel }),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  openAdminPanel: (adminPanel) => set({ adminPanel }),
  setViewMode: (viewMode) => {
    set((state) => {
      persistViewPrefs(viewMode, state.density);
      return { viewMode };
    });
  },
  setDensity: (density) => {
    set((state) => {
      persistViewPrefs(state.viewMode, density);
      return { density };
    });
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
      missingOnly: false,
    }),
}));
