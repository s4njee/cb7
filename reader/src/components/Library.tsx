/** Library — two shelves behind one grid.
 *
 *  **On device** is the home shelf: books this app owns, readable with the
 *  network off, present whether or not a server was ever configured. **Server**
 *  is the optional second shelf — browse a CB8 library and download from it.
 *  Everything below the shelf switch (filters, sort, status chips, the grid,
 *  the action sheet) is shared, because a book is a book. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as api from "../lib/api";
import { ACCENTS, type AccentName } from "../lib/fonts";
import {
  canRemoveLocalCopy,
  canSaveToDevice,
  sourceBadge,
} from "../lib/bookContext";
import { metaLine, percentRead, statusLabel, titleInitials } from "../lib/format";
import { parseLibraryQuery } from "../lib/searchText";
import { localSearch, type LocalSearchHit } from "../lib/transport";
import { fromQuery, LOAD_MESSAGES } from "../lib/loadState";
import {
  ContentSkeleton,
  StatusBanner,
  StatusView,
} from "./ui/StatusView";
import { usePrefs } from "../store/prefs";
import { useSession } from "../store/session";
import CoverArt from "./CoverArt";
import CoverCard, { type CardActionAnchor } from "./library/CoverCard";
import BookDetailSheet from "./library/BookDetailSheet";
import LinkedFoldersPanel from "./library/LinkedFoldersPanel";
import SearchIndexPanel from "./library/SearchIndexPanel";
import OpdsPanel from "./opds/OpdsPanel";
import ScopeRow from "./library/ScopeRow";
import SortControl from "./library/SortControl";
import StatusChips from "./library/StatusChips";
import { useLibrarySort } from "./library/librarySort";
import { usePullToRefresh } from "./library/usePullToRefresh";
import { useLibraryActions } from "./library/useLibraryActions";
import {
  applyClientParams,
  scopeKey,
  type Scope,
} from "./library/libraryData";
import ActiveFilters, { type FilterChip } from "./library/ActiveFilters";
import {
  forgetLibraryView,
  hasActiveFilters,
  recallLibraryView,
  rememberLibraryView,
  type Filter,
  type Shelf,
} from "./library/viewMemory";
import "../styles/library.css";

const PAGE_SIZE = 200;

export default function Library() {
  const {
    user,
    guest,
    serverUrl,
    openBook,
    reset,
    goConnect,
    openSheet,
    showToast,
    importTick,
    librarySearchTick,
  } = useSession();
  const accent = usePrefs((s) => s.accent);
  const setAccent = usePrefs((s) => s.setAccent);
  const signedIn = !!user && !guest;

  // Opening a book unmounts this screen, so where you were browsing is restored
  // from the session's view memory rather than reset to the top of the shelf.
  const restored = useRef(recallLibraryView(serverUrl)).current;

  const [filter, setFilter] = useState<Filter>(restored?.filter ?? "all");
  const [searchInput, setSearchInput] = useState(restored?.search ?? "");
  const [search, setSearch] = useState(restored?.search ?? "");
  const [readStatus, setReadStatus] = useState<api.ReadStatus | null>(restored?.readStatus ?? null);
  const [favorites, setFavorites] = useState(restored?.favorites ?? false);
  const [scope, setScope] = useState<Scope>(restored?.scope ?? { type: "all" });
  /** Local-only filters by tag / collection (server scopes handle their own). */
  const [tagFilter, setTagFilter] = useState<string | null>(restored?.tag ?? null);
  const [collectionFilter, setCollectionFilter] = useState<string | null>(restored?.collection ?? null);
  // Null until the first local listing settles, so the initial shelf can be
  // chosen from what actually exists rather than flickering between the two.
  const [shelfChoice, setShelfChoice] = useState<Shelf | null>(restored?.shelf ?? null);
  const [importing, setImporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Record ids selected for bulk operations (Cmd/Ctrl-click on cards). */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [linkedOpen, setLinkedOpen] = useState(false);
  const [searchIndexOpen, setSearchIndexOpen] = useState(false);
  const [opdsOpen, setOpdsOpen] = useState(false);
  const [sheet, setSheet] = useState<{ record: api.WebComicRecord; anchor: CardActionAnchor } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const { sort, setSortBy, toggleOrder } = useLibrarySort();

  // Per-user filters only apply when signed in; guests never see the chips.
  // Server-side per-user filters need a signed-in session; the local shelf is
  // inherently per-device, so they always apply there.
  const perUser = signedIn || shelfChoice === "local";
  const effStatus = perUser ? readStatus : null;
  const effFav = perUser ? favorites : false;

  const mediaType = filter === "all" ? undefined : filter;
  const isSeries = scope.type === "series";

  // Opening navigates away, so a second tap in the same beat would re-open on top.
  const openingRef = useRef(false);
  const open = useCallback(
    (record: api.WebComicRecord, target?: string | number | null) => {
      if (openingRef.current) return;
      openingRef.current = true;
      openBook(record, target ?? null);
      setTimeout(() => {
        openingRef.current = false;
      }, 700);
    },
    [openBook],
  );

  // The unmount handler must see the *latest* values, not the ones its closure
  // captured on mount, so the live snapshot is mirrored into a ref each render.
  const viewRef = useRef({
    shelf: shelfChoice,
    serverUrl,
    scope,
    search,
    filter,
    readStatus,
    favorites,
    tag: tagFilter,
    collection: collectionFilter,
  });
  viewRef.current = {
    shelf: shelfChoice,
    serverUrl,
    scope,
    search,
    filter,
    readStatus,
    favorites,
    tag: tagFilter,
    collection: collectionFilter,
  };
  useEffect(
    () => () => {
      rememberLibraryView({
        ...viewRef.current,
        scrollTop: scrollRef.current?.scrollTop ?? 0,
      });
    },
    [],
  );

  // Restore the scroll offset once, after the grid actually has rows to scroll
  // through — setting scrollTop on an empty container silently does nothing.
  const scrollRestored = useRef(restored == null || restored.scrollTop === 0);

  // Debounce the search box → server `?search=`.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Close the avatar menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  /* --------------------------------------------------------------- queries */

  // The on-device shelf. Cheap (a catalog read), never fails for want of a
  // network, and it decides which shelf we open on.
  const localQuery = useQuery({
    queryKey: ["local"],
    queryFn: api.listLocal,
    enabled: api.localSupported,
  });
  const localBooks = useMemo(() => localQuery.data ?? [], [localQuery.data]);

  // A server is usable once we're actually on it (signed in or as a guest).
  const serverReady = !!serverUrl && (!!user || guest);

  // Open on the shelf that has something to show: your own books if you have
  // any, otherwise the server you're already connected to. Local-first does not
  // mean showing an empty room to someone with a library one tap away.
  useEffect(() => {
    if (shelfChoice !== null) return;
    if (api.localSupported && localQuery.isLoading) return;
    setShelfChoice(localBooks.length > 0 || !serverReady ? "local" : "server");
  }, [shelfChoice, localQuery.isLoading, localBooks.length, serverReady]);

  // A book imported from outside the library (native menu, drag/drop) lands on
  // the local shelf — switch to it so the user sees what they just added.
  useEffect(() => {
    if (importTick > 0) setShelfChoice("local");
  }, [importTick]);

  // Native Edit > Find in Library… (Cmd/Ctrl+F) focuses the search box.
  useEffect(() => {
    if (librarySearchTick > 0) searchRef.current?.focus();
  }, [librarySearchTick]);

  const shelf: Shelf = shelfChoice ?? "local";
  const onServer = shelf === "server";

  // The background indexer's live status, so a search can say "still building"
  // instead of "no matches". Seeded once on mount (a pass may already be
  // running), then kept current by the indexer's own progress events.
  const [indexStatus, setIndexStatus] = useState({ indexing: false, done: 0, total: 0 });
  useEffect(() => {
    if (!api.localSupported) return;
    let off = () => {};
    let live = true;
    void api.localSearchSettings().then(({ indexing, done, total }) => {
      if (live) setIndexStatus({ indexing, done, total });
    });
    void api.onSearchIndexProgress((p) => setIndexStatus(p)).then((f) => {
      if (live) off = f;
      else f();
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  const { indexing, done: indexDone, total: indexTotal } = indexStatus;

  // Content search is intentionally separate from the cheap catalog filter: the
  // native index is disposable and may still be building. It runs on either
  // shelf — the books on this device are yours to search regardless of which
  // library you happen to be browsing.
  const localTextSearch = useQuery({
    queryKey: ["localTextSearch", search],
    queryFn: () => localSearch(search),
    enabled: !!search && api.localSupported,
  });
  // A pass that just finished may have indexed the very book being searched.
  useEffect(() => {
    if (!indexing && search) void localTextSearch.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexing]);
  const textHits = (localTextSearch.data ?? []) as LocalSearchHit[];

  // Searching the *server's* books by meaning. The embeddings sidecar is
  // optional and older servers lack the route entirely, so the first failure
  // latches the capability off for this server rather than retrying — and
  // failing — on every keystroke. A missing capability is not an error the
  // reader should show; the section simply doesn't appear.
  const [meaningOff, setMeaningOff] = useState(false);
  useEffect(() => setMeaningOff(false), [serverUrl]);
  const meaningSearch = useQuery({
    queryKey: ["meaningSearch", serverUrl, search],
    queryFn: () => api.searchInside(search),
    enabled: !!search && serverReady && !meaningOff,
    retry: false,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (meaningSearch.isError) setMeaningOff(true);
  }, [meaningSearch.isError]);
  const meaningHits = meaningSearch.data ?? [];
  // The server fuses its keyword index with the embeddings sidecar, and falls
  // back to keyword-only when the sidecar is down. Only claim "by meaning" when
  // at least one hit actually came from it.
  const byMeaning = meaningHits.some((hit) => hit.via !== "keyword");

  // Opening a server passage costs a record fetch (hits carry an id, not a
  // record). The chapter a hit names is a label, not an addressable position,
  // so this lands on the book — the in-book search (Cmd/Ctrl+F) takes it from
  // there, unlike the local index whose targets are exact.
  const openServerHit = useCallback(
    async (comicId: number) => {
      try {
        open(await api.getComic(comicId));
      } catch {
        showToast("Couldn't open that book.");
      }
    },
    [open, showToast],
  );

  // Hits arrive grouped by book (best-ranked book first); pair each group with
  // its catalog record and drop hits whose book is no longer on the shelf.
  const textGroups = useMemo(() => {
    const groups: Array<{ record: api.WebComicRecord; hits: LocalSearchHit[] }> = [];
    for (const hit of textHits) {
      const last = groups[groups.length - 1];
      if (last && last.record.id === hit.id) {
        last.hits.push(hit);
        continue;
      }
      const record = localBooks.find((book) => book.id === hit.id);
      if (record) groups.push({ record, hits: [hit] });
    }
    return groups;
  }, [textHits, localBooks]);

  // All-library and collection scopes are paged (offset-based infinite query).
  const paged = useInfiniteQuery({
    queryKey: [
      "comics",
      scopeKey(scope),
      mediaType ?? "all",
      search,
      sort.sortBy,
      sort.sortOrder,
      effStatus ?? "any",
      effFav,
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      // The server FTS already covers title/author/series/summary, so an
      // unprefixed query goes through verbatim. A field prefix (`series:foo`)
      // would tokenize to `series & foo` and match nothing — strip it so the
      // server searches the term itself (its vector spans all those fields).
      const serverSearch = parseLibraryQuery(search || "").term;
      const params: api.ListParams = {
        mediaType,
        search: serverSearch || undefined,
        sortBy: sort.sortBy,
        sortOrder: sort.sortOrder,
        readStatus: effStatus ?? undefined,
        favorites: effFav || undefined,
        limit: PAGE_SIZE,
        offset: pageParam,
      };
      return scope.type === "collection"
        ? api.libraryComics(scope.id, params)
        : api.listComics(params);
    },
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.records.length, 0);
      return loaded < last.totalCount ? loaded : undefined;
    },
    enabled: !isSeries && onServer && serverReady,
  });

  // Series scope is a bare, unpaged array — filter/sort it client-side.
  const seriesQuery = useQuery({
    queryKey: ["seriesComics", isSeries ? scope.name : ""],
    queryFn: () => api.seriesComics(isSeries ? scope.name : ""),
    enabled: isSeries && onServer && serverReady,
  });

  const continueQuery = useQuery({
    queryKey: ["continue"],
    queryFn: () => api.continueReading(1),
    enabled: onServer && serverReady,
  });

  const librariesQuery = useQuery({
    queryKey: ["libraries"],
    queryFn: api.listLibraries,
    enabled: onServer && serverReady,
  });
  const seriesListQuery = useQuery({
    queryKey: ["seriesList"],
    queryFn: api.listSeries,
    enabled: onServer && serverReady,
  });

  const clientParams = useMemo(
    () => ({
      search,
      mediaType,
      readStatus: effStatus ?? undefined,
      favorites: effFav,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      tag: tagFilter,
      collection: collectionFilter,
    }),
    [search, mediaType, effStatus, effFav, sort.sortBy, sort.sortOrder, tagFilter, collectionFilter],
  );

  const records = useMemo(() => {
    // The local shelf is an in-memory list, so every control is applied here —
    // the same filters the server applies to its own, so the two feel alike.
    if (!onServer) return applyClientParams(localBooks, clientParams);
    if (isSeries) {
      return applyClientParams(seriesQuery.data ?? [], clientParams);
    }
    return paged.data?.pages.flatMap((p) => p.records) ?? [];
  }, [onServer, localBooks, isSeries, seriesQuery.data, paged.data, clientParams]);

  useEffect(() => {
    if (scrollRestored.current || records.length === 0) return;
    scrollRestored.current = true;
    scrollRef.current?.scrollTo({ top: restored?.scrollTop ?? 0 });
  }, [records.length, restored]);

  // Bulk selection: toggle on Cmd/Ctrl-click, Escape to clear, and reset when
  // the visible scope changes so stale ids can't linger across shelves.
  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  useEffect(() => {
    setSelected(new Set());
  }, [shelfChoice, scope, filter, search]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const selectedRecords = useMemo(
    () => records.filter((r) => selected.has(r.id)),
    [records, selected],
  );

  const loadedCount = records.length;
  const totalCount =
    !onServer || isSeries ? loadedCount : paged.data?.pages[0]?.totalCount ?? loadedCount;
  // How many titles the current filters are hiding — but only where the
  // unfiltered total is actually known: the local shelf holds its whole catalog
  // in memory, and a series scope arrives as one array. The paged server scopes
  // only ever report the *filtered* count, and inventing a second request just
  // to print a denominator is not worth it.
  const unfilteredTotal = !onServer
    ? localBooks.length
    : isSeries
      ? seriesQuery.data?.length ?? null
      : null;
  const narrowed =
    unfilteredTotal != null && unfilteredTotal > totalCount ? unfilteredTotal : null;
  const countLabel =
    onServer && !isSeries && loadedCount < totalCount
      ? `${loadedCount} of ${totalCount} titles`
      : narrowed != null
        ? `${totalCount} of ${narrowed} titles`
        : `${totalCount} ${totalCount === 1 ? "title" : "titles"}`;

  /** One tap back to an unfiltered shelf — the explicit reset the backlog asks
   *  for, so a narrowing you didn't mean to keep is never a scavenger hunt. */
  const clearFilters = useCallback(() => {
    setSearchInput("");
    setSearch("");
    setFilter("all");
    setReadStatus(null);
    setFavorites(false);
    setTagFilter(null);
    setCollectionFilter(null);
    setScope({ type: "all" });
  }, []);

  // Only the narrowings that aren't already legible from a control on screen.
  // The media-type pills and status chips show their own active state a row
  // above; repeating them here would be noise, not clarity.
  const filterChips = useMemo<FilterChip[]>(() => {
    const chips: FilterChip[] = [];
    if (search) {
      chips.push({
        key: "search",
        kind: "Search",
        value: search,
        onRemove: () => {
          setSearchInput("");
          setSearch("");
        },
      });
    }
    if (scope.type !== "all") {
      chips.push({
        key: "scope",
        kind: scope.type === "series" ? "Series" : "Collection",
        value: scope.name,
        onRemove: () => setScope({ type: "all" }),
      });
    }
    if (tagFilter) {
      chips.push({ key: "tag", kind: "Tag", value: tagFilter, onRemove: () => setTagFilter(null) });
    }
    if (collectionFilter) {
      chips.push({
        key: "collection",
        kind: "Collection",
        value: collectionFilter,
        onRemove: () => setCollectionFilter(null),
      });
    }
    return chips;
  }, [search, scope, tagFilter, collectionFilter]);

  const filtered = hasActiveFilters({
    search,
    filter,
    readStatus: effStatus,
    favorites: effFav,
    tag: tagFilter,
    collection: collectionFilter,
    scope,
  });

  const shelfQuery = !onServer
    ? {
        isLoading: localQuery.isLoading,
        isFetching: localQuery.isFetching,
        isError: localQuery.isError,
        error: localQuery.error,
        hasData: localBooks.length > 0 || localQuery.isSuccess,
        refetch: () => void localQuery.refetch(),
      }
    : isSeries
      ? {
          isLoading: seriesQuery.isLoading,
          isFetching: seriesQuery.isFetching,
          isError: seriesQuery.isError,
          error: seriesQuery.error,
          hasData: (seriesQuery.data?.length ?? 0) > 0 || seriesQuery.isSuccess,
          refetch: () => void seriesQuery.refetch(),
        }
      : {
          isLoading: paged.isLoading,
          isFetching: paged.isFetching,
          isError: paged.isError,
          error: paged.error,
          hasData: (paged.data?.pages?.length ?? 0) > 0 || paged.isSuccess,
          refetch: () => void paged.refetch(),
        };

  const gridState = fromQuery({
    isLoading: shelfQuery.isLoading,
    isFetching: shelfQuery.isFetching,
    isError: shelfQuery.isError,
    error: shelfQuery.error,
    hasData: shelfQuery.hasData && records.length > 0,
    context: onServer ? "library" : "reader",
    loadingMessage: LOAD_MESSAGES.loadingLibrary,
  });
  // Empty success (filters / empty shelf) is not an error — only block on load/error.
  const blockGrid =
    (gridState.kind === "loading" && records.length === 0) ||
    ((gridState.kind === "error" || gridState.kind === "offline") &&
      records.length === 0);
  const softRefreshBanner =
    gridState.kind === "refreshing" &&
    gridState.canRetry &&
    gridState.detail
      ? gridState.detail
      : null;

  const featured = continueQuery.data?.[0];
  const showContinue =
    onServer &&
    scope.type === "all" &&
    filter === "all" &&
    !search &&
    !effFav &&
    !effStatus &&
    !!featured;

  const initials = useMemo(
    () => (user ? titleInitials(user.username) : "G"),
    [user],
  );

  /* ------------------------------------------------------ infinite scroll */

  useEffect(() => {
    if (isSeries || !onServer) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && paged.hasNextPage && !paged.isFetchingNextPage) {
          void paged.fetchNextPage();
        }
      },
      { root: scrollRef.current, rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isSeries, onServer, paged.hasNextPage, paged.isFetchingNextPage, paged.fetchNextPage, records.length]);

  /* ------------------------------------------------------ pull-to-refresh */

  const refresh = useCallback(async () => {
    if (!onServer) {
      await localQuery.refetch();
      return;
    }
    await Promise.all([
      isSeries ? seriesQuery.refetch() : paged.refetch(),
      continueQuery.refetch(),
    ]);
  }, [onServer, localQuery, isSeries, seriesQuery, paged, continueQuery]);

  const { pull, refreshing, enabled: ptrEnabled } = usePullToRefresh(scrollRef, refresh);

  /* --------------------------------------------------------- mutations */

  // Offline pins (Downloads sheet) — labels action-sheet context and drives
  // “Remove download” / cancel for in-flight pins.
  const downloadsQuery = useQuery({
    queryKey: ["downloads"],
    queryFn: () => api.listDownloads(),
    enabled: api.downloadsSupported && !!sheet,
    staleTime: 5_000,
  });

  const {
    toggleFavorite,
    markRead,
    markUnread,
    clearProgressAction,
    saveToDevice,
    removeLocalCopy,
    removeOfflineDownload,
    addBooks,
    addFolder,
    bulkMarkRead,
    bulkMarkUnread,
    bulkFavorite,
    bulkClearProgress,
    bulkRemoveLocal,
  } = useLibraryActions(showToast, downloadsQuery.data, setShelfChoice, setImporting);

  const openActions = useCallback(
    (record: api.WebComicRecord, anchor: CardActionAnchor) => setSheet({ record, anchor }),
    [],
  );

  /* --------------------------------------------------------- account menu */

  async function signOut() {
    setMenuOpen(false);
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    // The remembered scope belongs to a library we are leaving; restoring a
    // collection id onto someone else's server would be worse than forgetting.
    forgetLibraryView();
    reset();
  }

  function changeServer() {
    setMenuOpen(false);
    // No forgetting here: cancelling out of the connect screen should land you
    // back where you were. A view taken on another server is dropped by
    // `recallLibraryView` on its own terms.
    goConnect("server", { serverUrl });
  }

  async function clearCache() {
    setMenuOpen(false);
    try {
      await api.clearMediaCache();
    } catch {
      /* ignore */
    }
  }

  /** Host of the connected server, for the shelf tab. A full URL is too long
   *  for a tab and the scheme+port tell the reader nothing they care about. */
  const serverLabel = useMemo(() => {
    if (!serverUrl) return "Server";
    try {
      return new URL(serverUrl).hostname || "Server";
    } catch {
      return "Server";
    }
  }, [serverUrl]);

  /** An empty grid is only an *invitation* when the shelf itself is empty. With
   *  a filter or search active it's a normal no-results, and offering "Add
   *  books" there would misread the situation. */
  const emptyInvitation = !onServer && !search && !effFav && !effStatus && filter === "all";

  const emptyMessage = search
    ? "No titles match your search."
    : effFav
      ? "No favorites yet."
      : effStatus
        ? "Nothing here with that status."
        : onServer
          ? "Nothing here yet — add books on your server."
          : "Nothing on this device matches.";

  return (
    <div className="lib">
      <div className="lib-header">
        <div>
          <div className="eyebrow">Your library</div>
          <div className="lib-title">CB8</div>
        </div>
        <div className="header-right" ref={menuRef}>
          <div className="search-pill">
            <span className="search-glyph" />
            <input
              ref={searchRef}
              className="search-input"
              placeholder="Search titles"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          {search && (textGroups.length > 0 || meaningHits.length > 0 || indexing) && (
            <div className="local-search-results" role="listbox" aria-label="Search inside books">
              {(textGroups.length > 0 || indexing) && (
                <div className="local-search-label">Inside your books · on this device</div>
              )}
              {textGroups.map(({ record, hits }) => (
                <div key={record.id} className="local-search-group">
                  <div className="local-search-hit-title">{record.title}</div>
                  {hits.map((hit, i) => (
                    <button
                      key={`${hit.label}-${i}`}
                      type="button"
                      className="local-search-hit"
                      onClick={() => open(record, hit.target)}
                    >
                      <span className="local-search-hit-where">{hit.label}</span>
                      <span className="local-search-hit-snippet">{hit.snippet}</span>
                    </button>
                  ))}
                </div>
              ))}
              {/* The index builds in the background, so say so rather than
                  letting a half-built index look like "no matches". */}
              {indexing && (
                <div className="local-search-building">
                  Indexing your books{indexTotal > 0 ? ` — ${indexDone} of ${indexTotal}` : "…"}
                </div>
              )}
              {/* Two indexes, two sources, never blurred together: the device
                  index finds words, the server's finds meaning, and each hit
                  says which one produced it. */}
              {meaningHits.length > 0 && (
                <>
                  <div className="local-search-label">
                    {byMeaning ? "Inside your books, by meaning" : "Inside your books"} · on the
                    server
                  </div>
                  {meaningHits.map((hit, i) => (
                    <button
                      key={`${hit.comicId}-${i}`}
                      type="button"
                      className="local-search-hit"
                      onClick={() => void openServerHit(hit.comicId)}
                    >
                      <span className="local-search-hit-title">
                        {hit.book}
                        <span className={`local-search-via via-${hit.via}`}>
                          {hit.via === "keyword" ? "keyword" : "by meaning"}
                        </span>
                      </span>
                      {hit.chapter && <span className="local-search-hit-where">{hit.chapter}</span>}
                      <span className="local-search-hit-snippet">{hit.snippet}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          <button
            className="avatar"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Account"
          >
            {initials}
          </button>
          {menuOpen && (
            <div className="avatar-menu">
              <div className="menu-user">
                <div className="menu-user-name">
                  {user ? user.username : guest ? "Guest" : "On this device"}
                </div>
                <div className="menu-user-sub">{serverUrl || "No server connected"}</div>
              </div>
              <button
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  openSheet("stats");
                }}
              >
                Reading stats
              </button>
              {api.localSupported && (
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    addBooks();
                  }}
                >
                  Add books…
                </button>
              )}
              {api.localSupported && (
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setLinkedOpen(true);
                  }}
                >
                  Linked folders…
                </button>
              )}
              {api.opdsSupported && (
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setOpdsOpen(true);
                  }}
                >
                  OPDS catalogs…
                </button>
              )}
              {api.localSupported && (
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setSearchIndexOpen(true);
                  }}
                >
                  Search index…
                </button>
              )}
              {api.downloadsSupported && (
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    openSheet("downloads");
                  }}
                >
                  Downloads
                </button>
              )}
              {user && (
                <button className="menu-item" onClick={signOut}>
                  Sign out
                </button>
              )}
              {!user && serverUrl && (
                <button className="menu-item" onClick={changeServer}>
                  Sign in
                </button>
              )}
              <button className="menu-item" onClick={changeServer}>
                {serverUrl ? "Change server" : "Connect a server"}
              </button>
              <button className="menu-item" onClick={clearCache}>
                Clear image cache
              </button>
              <div className="menu-accent">
                <div className="menu-accent-label">Accent</div>
                <div className="accent-grid">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.name}
                      type="button"
                      className={`accent-swatch${accent === a.name ? " active" : ""}`}
                      style={{ background: a.hex }}
                      aria-label={a.label}
                      title={a.label}
                      onClick={() => setAccent(a.name as AccentName)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The shelf switch sits above every other control: which library you are
          looking at is a bigger question than how it is filtered. */}
      <div className="shelf-tabs" role="tablist" aria-label="Library">
        <button
          role="tab"
          aria-selected={!onServer}
          className={`shelf-tab${!onServer ? " active" : ""}`}
          onClick={() => {
            setShelfChoice("local");
            setScope({ type: "all" });
          }}
        >
          On device
          {localBooks.length > 0 && <span className="shelf-tab-n">{localBooks.length}</span>}
        </button>
        {serverReady ? (
          <button
            role="tab"
            aria-selected={onServer}
            className={`shelf-tab${onServer ? " active" : ""}`}
            onClick={() => setShelfChoice("server")}
          >
            {serverLabel}
          </button>
        ) : (
          <button className="shelf-tab ghost" onClick={changeServer}>
            + Connect a server
          </button>
        )}
      </div>

      <div className="filters">
        {(["all", "comic", "book"] as Filter[]).map((f) => (
          <button
            key={f}
            className={`filter-pill${filter === f ? " active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "comic" ? "Comics" : "Books"}
          </button>
        ))}
        <div className="count">{countLabel}</div>
      </div>

      {/* Sort rides the sub-filter row, right-aligned under the count, so the
          two rows of controls on the left stay tight against each other rather
          than being spaced apart by a taller header row. The row is always
          present (its height is already reserved) even when the status chips
          are not — signed-out shelves still sort. */}
      <div className="filters-sub">
        {perUser && (
          <StatusChips
            readStatus={readStatus}
            onReadStatus={setReadStatus}
            favorites={favorites}
            onFavorites={setFavorites}
          />
        )}
        <SortControl sort={sort} onSortBy={setSortBy} onToggleOrder={toggleOrder} />
      </div>

      {/* A search term survives a scope change — but only because it stays
          visible here, and removable in one tap. */}
      {filterChips.length > 0 && (
        <div className="filters-sub">
          <ActiveFilters chips={filterChips} count={countLabel} onClearAll={clearFilters} />
        </div>
      )}

      <div className="lib-scroll" ref={scrollRef}>
        {ptrEnabled && (pull > 0 || refreshing) && (
          <div className="lib-ptr" style={{ transform: `translateY(${pull - 24}px)`, opacity: Math.min(1, pull / 70) }}>
            <div
              className={`lib-ptr-spin${refreshing ? " spinning" : ""}`}
              style={{ transform: refreshing ? undefined : `rotate(${pull * 3}deg)` }}
            />
          </div>
        )}

        <div className="lib-content" style={{ transform: pull ? `translateY(${pull}px)` : undefined }}>
          {onServer && scope.type === "all" && (
            <ScopeRow
              libraries={librariesQuery.data ?? []}
              series={seriesListQuery.data ?? []}
              onPick={setScope}
            />
          )}

          {showContinue && featured && (
            <div className="continue-card">
              <button className="cont-cover" onClick={() => open(featured)}>
                <CoverArt record={featured} className="cont-cover-art" variant="continue" width={320} />
              </button>
              <div className="cont-right">
                <div className="cont-eyebrow">Continue reading</div>
                <div className="cont-title">{featured.title}</div>
                <div className="cont-meta">{metaLine(featured)}</div>
                <div className="cont-progress-row">
                  <div className="progress-track" style={{ maxWidth: 280 }}>
                    <div style={{ width: `${percentRead(featured)}%` }} />
                  </div>
                  <div className="progress-pct">{statusLabel(featured)}</div>
                </div>
                <button className="resume-btn" onClick={() => open(featured)}>
                  Resume →
                </button>
              </div>
            </div>
          )}

          {scope.type === "all" ? (
            <div className="section-label">{onServer ? "All titles" : "On this device"}</div>
          ) : (
            <button className="scope-breadcrumb" onClick={() => setScope({ type: "all" })}>
              <span className="crumb-root">‹ All titles</span>
              <span>·</span>
              <span className="crumb-name">{scope.name}</span>
            </button>
          )}

          {softRefreshBanner && records.length > 0 && (
            <StatusBanner text={softRefreshBanner} onRetry={shelfQuery.refetch} />
          )}

          {blockGrid && gridState.kind === "loading" ? (
            <ContentSkeleton count={8} />
          ) : blockGrid ? (
            <StatusView state={gridState} onRetry={shelfQuery.refetch} />
          ) : records.length === 0 ? (
            emptyInvitation ? (
              // Nothing here is an invitation, not an error: an empty shelf is
              // what a new install looks like, and both ways to fill it are one
              // tap away.
              <div className="empty-state empty-invite">
                <div className="empty-title">Your shelf is empty</div>
                <div>
                  Add books from this device, browse a public catalog, or
                  connect a CB8 server and save titles to your shelf.
                </div>
                <div className="empty-actions">
                  {api.localSupported && (
                    <>
                      <button className="btn-accent" onClick={addBooks} disabled={importing}>
                        {importing ? "Adding…" : "Add books"}
                      </button>
                      <button className="btn-ghost" onClick={addFolder} disabled={importing}>
                        Add folder…
                      </button>
                    </>
                  )}
                  {!serverReady && (
                    <button className="btn-ghost" onClick={changeServer}>
                      Connect a server
                    </button>
                  )}
                  {api.opdsSupported && (
                    <button className="btn-ghost" onClick={() => setOpdsOpen(true)}>
                      Browse a catalog
                    </button>
                  )}
                </div>
              </div>
            ) : (
              // A no-results screen should hand back the way out it took to get
              // here, rather than leaving the user to guess which narrowing did
              // it — this is the explicit reset for a scope change that ate the
              // results.
              <div className="empty-state">
                <div>{emptyMessage}</div>
                {filtered && (
                  <div className="empty-actions">
                    <button className="btn-ghost" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            )
          ) : (
            <>
              {selected.size > 0 && (
                <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
                  <span className="bulk-count">
                    {selected.size} selected
                    <button
                      type="button"
                      className="bulk-clear"
                      onClick={() => setSelected(new Set())}
                    >
                      Clear (Esc)
                    </button>
                  </span>
                  <span className="bulk-actions">
                    <button type="button" onClick={() => bulkMarkRead(selectedRecords)}>
                      Mark read
                    </button>
                    <button type="button" onClick={() => bulkMarkUnread(selectedRecords)}>
                      Mark unread
                    </button>
                    <button type="button" onClick={() => bulkFavorite(selectedRecords)}>
                      Favorite
                    </button>
                    <button type="button" onClick={() => bulkClearProgress(selectedRecords)}>
                      Clear progress
                    </button>
                    {!onServer && (
                      <button type="button" onClick={() => bulkRemoveLocal(selectedRecords)}>
                        Remove local copy
                      </button>
                    )}
                  </span>
                </div>
              )}
              <div className="grid">
                {records.map((r) => (
                  <CoverCard
                    key={r.id}
                    record={r}
                    onOpen={open}
                    onToggleFavorite={signedIn || !onServer ? toggleFavorite : undefined}
                    onActions={signedIn || !onServer ? openActions : undefined}
                    selected={selected.has(r.id)}
                    onToggleSelect={() => toggleSelect(r.id)}
                  />
                ))}
              </div>

              {onServer && !isSeries && <div className="grid-sentinel" ref={sentinelRef} />}
              {onServer && !isSeries && paged.isFetchingNextPage && (
                <div className="load-more">
                  <span className="status-spinner" aria-hidden="true" />
                  Loading more…
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {sheet && (() => {
        const r = sheet.record;
        const pin = (downloadsQuery.data ?? []).find((d) => d.comicId === r.id);
        const offlinePinned = !!pin?.complete;
        const offlineDownloading =
          !!pin &&
          !pin.complete &&
          (pin.status === "active" || pin.status === "queued");
        const badge = sourceBadge({
          record: r,
          serverUrl,
          localBooks,
          offlinePinned,
          offlineDownloading,
        });
        return (
          <BookDetailSheet
            record={r}
            badge={badge}
            showSaveToDevice={canSaveToDevice(r, localBooks, serverUrl, api.localSupported)}
            showRemoveLocalCopy={canRemoveLocalCopy(r)}
            // Legacy offline-pin cleanup only — new downloads use Save to device.
            showRemoveDownload={!!pin}
            onMetadataSaved={() => void localQuery.refetch()}
            onFilterTag={(tag) => {
              setTagFilter(tag);
              setCollectionFilter(null);
              setSheet(null);
            }}
            onFilterCollection={(collection) => {
              setCollectionFilter(collection);
              setTagFilter(null);
              setSheet(null);
            }}
            onClose={() => setSheet(null)}
            onLocate={async (rec) => {
              const { open } = await import("@tauri-apps/plugin-dialog");
              const picked = await open({ multiple: false });
              if (!picked || Array.isArray(picked)) return;
              try {
                await api.localLocateLinkedBook(rec.id, String(picked));
                await localQuery.refetch();
                setSheet(null);
                showToast("Re-located the book.");
              } catch {
                showToast("Couldn't locate that file.");
              }
            }}
            actions={{
              onOpen: open,
              onMarkRead: markRead,
              onMarkUnread: markUnread,
              onClearProgress: clearProgressAction,
              onToggleFavorite: toggleFavorite,
              onSaveToDevice: api.localSupported ? saveToDevice : undefined,
              onRemoveLocalCopy: removeLocalCopy,
              onRemoveDownload: api.downloadsSupported ? removeOfflineDownload : undefined,
            }}
          />
        );
      })()}

      {linkedOpen && (
        <div className="sheet-backdrop" onClick={() => setLinkedOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <LinkedFoldersPanel
              onChanged={() => void localQuery.refetch()}
              onClose={() => setLinkedOpen(false)}
            />
          </div>
        </div>
      )}

      {searchIndexOpen && (
        <div className="sheet-backdrop" onClick={() => setSearchIndexOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <SearchIndexPanel onClose={() => setSearchIndexOpen(false)} />
          </div>
        </div>
      )}

      {opdsOpen && (
        <div className="sheet-backdrop" onClick={() => setOpdsOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <OpdsPanel
              onClose={() => setOpdsOpen(false)}
              onImported={() => {
                void localQuery.refetch();
                setShelfChoice("local");
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
