/** EPUB reader powered by Readium TS Toolkit (`@readium/navigator`).
 *
 *  Unpacks the EPUB client-side into a WebPub + ZipFetcher (see readiumZip.ts),
 *  then drives EpubNavigator for reflowable/fixed layout, progress (Locator
 *  JSON), TOC, and theme preferences. PDF stays on PdfReader — Readium Web
 *  does not ship a PDF navigator yet.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "../lib/api";
import { loadBookData } from "../lib/epub";
import type { EpubTocItem } from "../lib/epub";
import {
  firstReadingPosition,
  matchSpineHref,
  openEpubAsPublication,
  splitHref,
  type OpenedReadiumEpub,
} from "../lib/readiumZip";
import {
  createAndLoadNavigator,
  locatorToProgressString,
  progressStringToLocator,
  themeToPreferences,
  totalProgressionOf,
  type EpubNavigator,
} from "../lib/readiumView";
import { installScrollChapterBridge } from "../lib/scrollChapterBridge";
import { findMatches } from "../lib/searchText";
import type { SearchHit } from "./readerTypes";
import { Locator } from "@readium/shared";
import { epubColors, hostMetrics } from "../lib/epubTheme";
import { clearLegacyBookmarks, loadLegacyBookmarks } from "../lib/localBookmarks";
import {
  excerpt,
  loadHighlights,
  saveHighlights,
  type StoredHighlight,
  type SwatchId,
} from "../lib/highlights";
import { stripChapterNumber } from "../lib/epubDom";
import { roman } from "../lib/format";
import { useDeviceTransfer } from "../lib/deviceTransfer";
import {
  classifyError,
  loadingState,
  LOAD_MESSAGES,
  readyState,
  type LoadState,
} from "../lib/loadState";
import { fontIdFor, usePrefs } from "../store/prefs";
import { useSession } from "../store/session";
import HighlightPopover, { type HighlightPopoverState } from "./HighlightPopover";
import { StatusOverlay } from "./ui/StatusView";
import type {
  BookmarkItem,
  ChapterItem,
  HighlightItem,
  ReaderApi,
  ReaderReportedState,
} from "./readerTypes";

interface TextReaderProps {
  record: api.WebComicRecord;
  onState: (state: ReaderReportedState) => void;
  /**
   * Scroll mode has no host tap-zones (they would block the iframe scroll).
   * Readium middle-third taps call `miscPointer` — use that to toggle chrome.
   */
  onToggleChrome?: () => void;
}

const TextReader = forwardRef<ReaderApi, TextReaderProps>(function TextReader(
  { record, onState, onToggleChrome },
  ref,
) {
  const qc = useQueryClient();
  const prefs = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const onToggleChromeRef = useRef(onToggleChrome);
  onToggleChromeRef.current = onToggleChrome;
  const serverUrl = useSession((s) => s.serverUrl) ?? "";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<EpubNavigator | null>(null);
  const openedRef = useRef<OpenedReadiumEpub | null>(null);
  const locatorRef = useRef<Locator | null>(
    progressStringToLocator(record.lastLocation) ?? null,
  );
  const closingRef = useRef(false);

  const [toc, setToc] = useState<EpubTocItem[]>([]);
  const [percent, setPercent] = useState<number | null>(null);
  const [pageLabel, setPageLabel] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [canSeek, setCanSeek] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [fixed, setFixed] = useState(false);
  const [bookmarks, setBookmarks] = useState<api.ServerBookmark[]>([]);
  const [highlights, setHighlights] = useState<StoredHighlight[]>(() =>
    loadHighlights(serverUrl, record.id),
  );
  const [load, setLoad] = useState<LoadState>(() =>
    loadingState(LOAD_MESSAGES.loadingBook),
  );
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const bookOpen = load.kind === "ready";
  const [hlPop, setHlPop] = useState<HighlightPopoverState | null>(null);
  const pendingTextRef = useRef("");
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;

  const fontId = fontIdFor(prefs, record.id);

  const applyPreferences = useCallback(async () => {
    const nav = navRef.current;
    if (!nav || fixed) return;
    const p = prefsRef.current;
    const columns = (!p.flow || p.flow === "paginated") && p.epubColumns === 2 ? 2 : 1;
    try {
      const { EpubPreferences } = await import("@readium/navigator");
      await nav.submitPreferences(
        new EpubPreferences(
          themeToPreferences(p.theme, {
            fontId: fontIdFor(p, record.id),
            fontScale: p.fontScale,
            lineHeight: p.lineHeight,
            scroll: p.flow === "scrolled",
            columnCount: columns,
          }),
        ),
      );
    } catch {
      /* mid-teardown */
    }
  }, [fixed, record.id]);

  const persistHighlights = useCallback(
    (next: StoredHighlight[]) => {
      highlightsRef.current = next;
      setHighlights(next);
      saveHighlights(serverUrl, record.id, next);
    },
    [serverUrl, record.id],
  );

  const removeHighlight = useCallback(
    (cfi: string) => {
      persistHighlights(highlightsRef.current.filter((h) => h.cfi !== cfi));
      setHlPop(null);
    },
    [persistHighlights],
  );

  const addHighlight = useCallback(
    (cfi: string, color: SwatchId, text: string) => {
      const existing = highlightsRef.current.find((h) => h.cfi === cfi);
      const next: StoredHighlight = {
        cfi,
        color,
        text: existing?.text || excerpt(text),
        createdAt: existing?.createdAt ?? Date.now(),
      };
      persistHighlights([...highlightsRef.current.filter((h) => h.cfi !== cfi), next]);
      setHlPop(null);
      // Full Decorator API wiring is a follow-up; store highlights for the drawer.
    },
    [persistHighlights],
  );

  /* ----------------------------------------------------- load + render */

  useEffect(() => {
    let cancelled = false;
    let opened: OpenedReadiumEpub | null = null;
    let nav: EpubNavigator | null = null;
    /** Detach continuous-scroll chapter bridge from the active iframe. */
    let detachScrollBridge: (() => void) | null = null;
    /** frameLoaded can fire during load() before navRef is assigned. */
    let pendingScrollWindow: Window | null = null;

    const attachScrollBridge = (wnd: Window) => {
      detachScrollBridge?.();
      detachScrollBridge = installScrollChapterBridge(wnd, {
        isScrollMode: () =>
          prefsRef.current.flow === "scrolled" &&
          !(openedRef.current?.isFixedLayout),
        goNext: () => navRef.current?.goForward(false, () => {}),
        goPrev: () => navRef.current?.goBackward(false, () => {}),
      });
    };

    const teardown = async () => {
      detachScrollBridge?.();
      detachScrollBridge = null;
      pendingScrollWindow = null;
      try {
        await nav?.destroy();
      } catch {
        /* */
      }
      try {
        opened?.close();
      } catch {
        /* */
      }
      nav = null;
      opened = null;
    };

    let unlistenProgress: (() => void) | undefined;
    if (record.source !== "local" && api.localSupported) {
      useDeviceTransfer.getState().start(record.id, record.title);
      void api
        .onLocalDownloadProgress((p) => {
          if (cancelled || p.comicId !== record.id) return;
          if (p.done) {
            setDownloadPct(null);
            return;
          }
          setDownloadPct(p.total ? Math.round((p.received / p.total) * 100) : 0);
        })
        .then((off) => {
          if (cancelled) off();
          else unlistenProgress = off;
        });
    }

    async function load() {
      const container = containerRef.current;
      if (!container) return;
      closingRef.current = false;
      setLoad(loadingState(LOAD_MESSAGES.loadingBook));
      setDownloadPct(null);
      setAtEnd(false);
      setCanSeek(false);
      container.replaceChildren();

      try {
        const { source, localId } = await loadBookData(record);
        if (cancelled) return;
        setDownloadPct(null);
        if (localId != null && record.source !== "local") {
          qc.invalidateQueries({ queryKey: ["local"] });
        }

        opened = await openEpubAsPublication(source);
        if (cancelled) return teardown();
        openedRef.current = opened;
        setFixed(opened.isFixedLayout);
        setToc(
          opened.toc.map((t) => ({
            href: t.href,
            label: t.label,
          })),
        );

        const p = prefsRef.current;
        const preferences = themeToPreferences(p.theme, {
          fontId: fontIdFor(p, record.id),
          fontScale: p.fontScale,
          lineHeight: p.lineHeight,
          scroll: !opened.isFixedLayout && p.flow === "scrolled",
          columnCount: p.epubColumns === 2 ? 2 : 1,
        });

        const initial =
          locatorRef.current ||
          progressStringToLocator(record.lastLocation) ||
          firstReadingPosition(opened.positions) ||
          opened.positions[0];

        nav = await createAndLoadNavigator({
          container,
          publication: opened.publication,
          positions: opened.positions,
          initialLocator: initial,
          preferences,
          listeners: {
            // Re-attach overscroll → next/prev chapter when the active frame changes.
            frameLoaded: (wnd) => {
              if (cancelled) return;
              if (navRef.current) attachScrollBridge(wnd);
              else pendingScrollWindow = wnd;
            },
            // Middle-third tap inside the iframe (scroll mode has no host tap-zones).
            miscPointer: () => {
              onToggleChromeRef.current?.();
            },
            positionChanged: (locator) => {
              if (closingRef.current) return;
              locatorRef.current = locator;
              const total = totalProgressionOf(locator);
              let pct: number | undefined;
              if (typeof total === "number") {
                pct = Math.min(100, Math.max(0, Math.round(total * 100)));
                setPercent(pct);
                setAtEnd(total >= 0.995);
              }
              // Spine index, not typographic pages — label as Section.
              const pos = locator.locations?.position;
              const n = opened?.positions.length ?? 0;
              if (typeof pos === "number" && n > 0) {
                setPageCount(n);
                setPageNumber(pos);
                setPageLabel(`Section ${pos} of ${n}`);
              }
              const locStr = locatorToProgressString(locator);
              api.scheduleProgress(record, {
                location: locStr,
                ...(pct != null ? { percent: pct } : {}),
              });
            },
            textSelected: (sel) => {
              const text = sel.text?.trim() ?? "";
              if (!text) return;
              pendingTextRef.current = text;
              // Locator for selection is not always present; use current as key fallback.
              const loc = locatorRef.current;
              const key = loc ? locatorToProgressString(loc) + ":" + text.slice(0, 32) : text;
              setHlPop({
                anchor: { x: window.innerWidth / 2, y: 120 },
                cfiRange: key,
                existing:
                  highlightsRef.current.find((h) => h.cfi === key)?.color ?? null,
              });
            },
            // Called when the navigator can't resolve an in-book link itself
            // (bad path join, etc.). Retry with our spine matcher.
            handleLocator: (locator) => {
              const href = locator.href;
              if (!href || /^(https?:|mailto:|tel:)/i.test(href)) return false;
              // Defer so we use the goToHref closed over after nav is assigned.
              void Promise.resolve().then(() => {
                const n = navRef.current;
                if (!n) return;
                const spineHrefs = n.publication.readingOrder.items.map((l) => l.href);
                const { path, fragment } = splitHref(href);
                const spineHref =
                  matchSpineHref(spineHrefs, path) ||
                  n.publication.readingOrder.findWithHref(path)?.href;
                if (!spineHref) return;
                const type =
                  n.publication.readingOrder.findWithHref(spineHref)?.type ||
                  "application/xhtml+xml";
                const loc = Locator.deserialize({
                  href: spineHref,
                  type,
                  locations: fragment
                    ? { fragments: [fragment.replace(/^#/, "")] }
                    : { progression: 0 },
                });
                if (loc) n.go(loc, false, () => {});
              });
              return true;
            },
          },
        });
        if (cancelled) return teardown();
        navRef.current = nav;
        // Initial frameLoaded ran during load() before navRef was set.
        if (pendingScrollWindow) {
          attachScrollBridge(pendingScrollWindow);
          pendingScrollWindow = null;
        } else {
          try {
            const wnd = (
              nav as unknown as {
                _cframes?: { iframe?: HTMLIFrameElement }[];
              }
            )._cframes?.[0]?.iframe?.contentWindow;
            if (wnd) attachScrollBridge(wnd);
          } catch {
            /* frame not ready */
          }
        }

        setCanSeek(true);
        setLoad(readyState());
      } catch (err) {
        setLoad(classifyError(err, "reader"));
      }
    }

    void load();

    return () => {
      cancelled = true;
      unlistenProgress?.();
      closingRef.current = true;
      void api.flushProgress(record);
      void teardown().then(() => {
        navRef.current = null;
        openedRef.current = null;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, reloadNonce]);

  useEffect(() => {
    if (!bookOpen || fixed) return;
    void applyPreferences();
  }, [
    bookOpen,
    fixed,
    prefs.theme,
    prefs.fontScale,
    prefs.lineHeight,
    prefs.flow,
    prefs.epubColumns,
    fontId,
    applyPreferences,
  ]);

  /* ------------------------------------------------------- bookmarks */

  useEffect(() => {
    let alive = true;
    void (async () => {
      let server: api.ServerBookmark[];
      try {
        server = await api.listBookmarks(record);
      } catch {
        return;
      }
      if (!alive) return;
      setBookmarks(server);
      const legacy = loadLegacyBookmarks(serverUrl, record.id);
      if (legacy.length === 0) return;
      const known = new Set(server.map((b) => b.location).filter(Boolean));
      const created: api.ServerBookmark[] = [];
      for (const b of legacy) {
        if (known.has(b.cfi)) continue;
        try {
          created.push(await api.createBookmark(record, { location: b.cfi }));
        } catch {
          return;
        }
      }
      clearLegacyBookmarks(serverUrl, record.id);
      if (alive && created.length) setBookmarks((list) => [...list, ...created]);
    })();
    return () => {
      alive = false;
    };
  }, [record.id, serverUrl]);

  /* --------------------------------------------- derived / reporting */

  const currentHref = locatorRef.current?.href ?? "";
  // Don't force index 0 when on the cover — that made "Section I" look active
  // for the front matter.
  const currentIndex = toc.findIndex(
    (t) => t.href.split("#")[0] === currentHref.split("#")[0],
  );

  const chapters: ChapterItem[] = toc.map((t, i) => ({
    key: `${t.href}-${i}`,
    num: roman(i),
    title: stripChapterNumber(t.label) || `Chapter ${i + 1}`,
    target: t.href,
    active: currentIndex >= 0 && i === currentIndex,
  }));

  const chapterLabel =
    currentIndex >= 0 && toc.length
      ? `${roman(currentIndex)}.  ${stripChapterNumber(toc[currentIndex]?.label)}`
      : "";

  const locationBookmarks = useMemo(
    () => bookmarks.filter((b): b is api.ServerBookmark & { location: string } => !!b.location),
    [bookmarks],
  );

  const locStr = locatorRef.current ? locatorToProgressString(locatorRef.current) : null;
  const isBookmarked = !!locStr && locationBookmarks.some((b) => b.location === locStr);

  const toggleBookmark = useCallback(async () => {
    const loc = locatorRef.current;
    if (!loc) return;
    const location = locatorToProgressString(loc);
    const existing = bookmarks.find((b) => b.location === location);
    if (existing) {
      setBookmarks((bm) => bm.filter((b) => b.id !== existing.id));
      api.deleteBookmark(record, existing.id).catch(() => {
        setBookmarks((bm) => [...bm, existing]);
      });
    } else {
      try {
        const created = await api.createBookmark(record, { location });
        setBookmarks((bm) => [...bm, created]);
      } catch {
        /* guest */
      }
    }
  }, [bookmarks, record.id]);

  const bookmarkItems: BookmarkItem[] = useMemo(
    () =>
      locationBookmarks.map((b) => ({
        key: String(b.id),
        title: record.title,
        label: b.note || "Bookmark",
        target: b.location,
      })),
    [locationBookmarks, record.title],
  );

  const highlightItems: HighlightItem[] = useMemo(
    () =>
      highlights.map((h) => ({
        key: h.cfi,
        color: h.color,
        text: h.text,
        target: h.cfi,
      })),
    [highlights],
  );

  const goToHref = useCallback((rawHref: string) => {
    const nav = navRef.current;
    if (!nav) return;

    // Ignore external / blob leftovers; only navigate publication resources.
    let href = rawHref.trim();
    if (!href || /^(https?:|mailto:|tel:|blob:|data:)/i.test(href)) return;

    // Same-document fragment while already reading a spine item.
    if (href.startsWith("#")) {
      const cur = locatorRef.current;
      if (!cur) return;
      const locator = cur.copyWithLocations({ fragments: [href.slice(1)] });
      nav.go(locator, false, () => {});
      return;
    }

    const { path, fragment } = splitHref(href);
    const spineHrefs = nav.publication.readingOrder.items.map((l) => l.href);
    // Resolve relative to the current resource when the link is page-relative.
    const currentPath = locatorRef.current?.href?.split("#")[0] ?? "";
    const fromCurrent = currentPath
      ? // local resolvePath is zip-aware; mimic path.join(dirname, rel)
        (() => {
          try {
            const baseDir = currentPath.includes("/")
              ? currentPath.slice(0, currentPath.lastIndexOf("/") + 1)
              : "";
            const joined = (baseDir + path).replace(/\/+/g, "/");
            const parts: string[] = [];
            for (const seg of joined.split("/")) {
              if (!seg || seg === ".") continue;
              if (seg === "..") parts.pop();
              else parts.push(seg);
            }
            return parts.join("/");
          } catch {
            return path;
          }
        })()
      : path;

    const spineHref =
      matchSpineHref(spineHrefs, fromCurrent) ||
      matchSpineHref(spineHrefs, path) ||
      nav.publication.readingOrder.findWithHref(fromCurrent)?.href ||
      nav.publication.readingOrder.findWithHref(path)?.href;
    if (!spineHref) {
      console.warn("[readium] TOC/link not in spine:", rawHref);
      return;
    }

    const spineLink = nav.publication.readingOrder.findWithHref(spineHref);
    const type = spineLink?.type || "application/xhtml+xml";
    // Fragments without '#' — getHtmlId treats bare ids as HTML anchors.
    const locator =
      Locator.deserialize({
        href: spineHref,
        type,
        locations: fragment
          ? { fragments: [fragment.replace(/^#/, "")] }
          : { progression: 0 },
      }) ?? undefined;
    if (locator) {
      nav.go(locator, false, () => {});
      return;
    }
    if (spineLink) nav.goLink(spineLink, false, () => {});
  }, []);

  // In-book search: walk the spine, read each section's text through the
  // publication, and collapse matches to one hit per section (jump target is
  // the section href, which `goToHref` navigates to). Reading is chunked and
  // best-effort so a search never hangs on a giant section.
  const searchBook = useCallback(
    async (query: string): Promise<SearchHit[]> => {
      const opened = openedRef.current;
      if (!opened) return [];
      const q = query.trim();
      if (!q) return [];
      const publication = opened.publication;
      const items = publication.readingOrder.items;
      const hits: SearchHit[] = [];
      const CHUNK = 8;
      for (let start = 0; start < items.length; start += CHUNK) {
        const end = Math.min(start + CHUNK, items.length);
        const chunk = items.slice(start, end);
        const texts = await Promise.all(
          chunk.map(async (link) => {
            try {
              const res = publication.get(link);
              const raw = await res.readAsString();
              return raw ?? "";
            } catch {
              return "";
            }
          }),
        );
        chunk.forEach((link, i) => {
          const text = texts[i];
          if (!text) return;
          const matches = findMatches(text, q);
          if (!matches.length) return;
          const tocEntry = opened.toc.find((t) => t.href === link.href);
          hits.push({
            target: link.href,
            label: tocEntry?.label ?? link.href,
            snippet: matches[0].snippet,
            count: matches.length,
          });
        });
        if (hits.length >= 200) break;
      }
      return hits;
    },
    [],
  );

  useImperativeHandle(
    ref,
    (): ReaderApi => ({
      next: () => navRef.current?.goForward(false, () => {}),
      prev: () => navRef.current?.goBackward(false, () => {}),
      toggleBookmark: () => void toggleBookmark(),
      goToChapter: (target) => goToHref(String(target)),
      goToBookmark: (item) => {
        const loc = progressStringToLocator(String(item.target));
        if (loc) navRef.current?.go(loc, false, () => {});
        else goToHref(String(item.target));
      },
      getPosition: () =>
        locatorRef.current ? locatorToProgressString(locatorRef.current) : null,
      goTo: (target) => {
        const loc = progressStringToLocator(String(target));
        if (loc) navRef.current?.go(loc, false, () => {});
      },
      goToPage: (n) => {
        const positions = openedRef.current?.positions;
        if (!positions?.length) return;
        const idx = Math.min(positions.length, Math.max(1, n)) - 1;
        navRef.current?.go(positions[idx], false, () => {});
      },
      goToPercent: (pct) => {
        const positions = openedRef.current?.positions;
        if (!positions?.length) return;
        const frac = Math.min(1, Math.max(0, pct / 100));
        const idx = Math.min(
          positions.length - 1,
          Math.max(0, Math.round(frac * (positions.length - 1))),
        );
        navRef.current?.go(positions[idx], false, () => {});
      },
      goToHighlight: (item) => {
        const loc = progressStringToLocator(String(item.target).split(":")[0]);
        if (loc) navRef.current?.go(loc, false, () => {});
      },
      removeHighlight,
      search: (query) => searchBook(query),
    }),
    [toggleBookmark, removeHighlight, goToHref, searchBook],
  );

  useEffect(() => {
    onState({
      pageLabel,
      percent,
      chapters,
      hasContents: true,
      isBookmarked,
      bookmarks: bookmarkItems,
      highlights: highlightItems,
      pageCount,
      pageNumber,
      canSeek,
      atEnd,
      bottomExtra: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    onState,
    pageLabel,
    percent,
    isBookmarked,
    currentIndex,
    toc,
    bookmarkItems,
    highlightItems,
    pageCount,
    pageNumber,
    canSeek,
    atEnd,
  ]);

  const twoCol = !fixed && prefs.flow === "paginated" && prefs.epubColumns === 2;
  const scrolled = !fixed && prefs.flow === "scrolled";
  const pageBg = epubColors(prefs.theme).bg;
  const metrics =
    fixed || scrolled
      ? { paddingInline: "0px", maxWidth: "none" }
      : twoCol
        ? { paddingInline: `${Math.round(prefs.margin * 100)}%`, maxWidth: "none" as const }
        : hostMetrics(prefs.margin, prefs.columnWidth, prefs.fontScale * 20);

  return (
    <div
      className={`epub-wrap${fixed ? " fixed" : ""}${twoCol ? " two-col" : ""}${scrolled ? " scrolled" : ""}`}
      data-reading-theme={prefs.theme}
      style={{ background: pageBg, colorScheme: prefs.theme === "dark" ? "dark" : "light" }}
    >
      {chapterLabel && !fixed && (
        <div className={`chapter-label${scrolled ? " over-content" : ""}`}>
          {chapterLabel}
        </div>
      )}
      <div className="epub-viewport" style={{ background: pageBg }}>
        <div
          className="epub-measure"
          style={{
            paddingInline: metrics.paddingInline,
            maxWidth: metrics.maxWidth,
            background: pageBg,
          }}
        >
          <div
            ref={containerRef}
            className="epub-host readium-host"
            style={{ background: pageBg }}
          />
        </div>
      </div>
      {!bookOpen && (
        <StatusOverlay
          state={
            downloadPct != null
              ? loadingState(
                  downloadPct > 0
                    ? `${LOAD_MESSAGES.savingToDevice} ${downloadPct}%`
                    : LOAD_MESSAGES.savingToDevice,
                )
              : load
          }
          percent={downloadPct}
          onRetry={() => setReloadNonce((n) => n + 1)}
        />
      )}
      {hlPop && (
        <HighlightPopover
          state={hlPop}
          onPick={(color) => addHighlight(hlPop.cfiRange, color, pendingTextRef.current)}
          onRemove={() => removeHighlight(hlPop.cfiRange)}
          onClose={() => setHlPop(null)}
        />
      )}
    </div>
  );
});

export default TextReader;
