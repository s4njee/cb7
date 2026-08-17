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
import "../styles/library.css";

type Filter = "all" | "comic" | "book";
/** Which shelf the grid is showing. */
type Shelf = "local" | "server";

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

  const [filter, setFilter] = useState<Filter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [readStatus, setReadStatus] = useState<api.ReadStatus | null>(null);
  const [favorites, setFavorites] = useState(false);
  const [scope, setScope] = useState<Scope>({ type: "all" });
  /** Local-only filters by tag / collection (server scopes handle their own). */
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
  // Null until the first local listing settles, so the initial shelf can be
  // chosen from what actually exists rather than flickering between the two.
  const [shelfChoice, setShelfChoice] = useState<Shelf | null>(null);
  const [importing, setImporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Record ids selected for bulk operations (Cmd/Ctrl-click on cards). */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [linkedOpen, setLinkedOpen] = useState(false);
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
    (record: api.WebComicRecord) => {
      if (openingRef.current) return;
      openingRef.current = true;
      openBook(record);
      setTimeout(() => {
        openingRef.current = false;
      }, 700);
    },
    [openBook],
  );

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
  const countLabel =
    onServer && !isSeries && loadedCount < totalCount
      ? `${loadedCount} of ${totalCount} titles`
      : `${totalCount} ${totalCount === 1 ? "title" : "titles"}`;

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
    reset();
  }

  function changeServer() {
    setMenuOpen(false);
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
        <SortControl sort={sort} onSortBy={setSortBy} onToggleOrder={toggleOrder} />
        <div className="count">{countLabel}</div>
      </div>

      {perUser && (
        <div className="filters-sub">
          <StatusChips
            readStatus={readStatus}
            onReadStatus={setReadStatus}
            favorites={favorites}
            onFavorites={setFavorites}
          />
        </div>
      )}

      {!onServer && (tagFilter || collectionFilter) && (
        <div className="filters-sub meta-filter">
          <span className="meta-filter-label">
            {tagFilter ? `Tag: ${tagFilter}` : `Collection: ${collectionFilter}`}
          </span>
          <button
            type="button"
            className="filter-pill"
            onClick={() => {
              setTagFilter(null);
              setCollectionFilter(null);
            }}
          >
            Clear
          </button>
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
                  Add books from this device, or connect a CB8 server and save
                  titles to your shelf.
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
                </div>
              </div>
            ) : (
              <div className="empty-state">{emptyMessage}</div>
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
    </div>
  );
}
