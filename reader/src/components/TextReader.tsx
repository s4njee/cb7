/** EPUB reader powered by epub.js. Renders reflowable books as paginated
 *  columns or one continuous scroll, renders fixed-layout books as the pages
 *  their designer drew, themes the sandboxed iframe from app tokens, tracks
 *  whole-book progress via the generated location index, and layers footnote
 *  previews, highlights and dictionary lookups over the book's own DOM. */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import * as api from "../lib/api";
import { lookup, isLookupWord, type DictionaryResult } from "../lib/dictionary";
import {
  createEpub,
  flattenToc,
  isFixedLayout,
  loadBookData,
  spineTargetFor,
} from "../lib/epub";
import type {
  EpubBook,
  EpubContents,
  EpubRendition,
  EpubSpread,
  EpubTocItem,
} from "../lib/epub";
import { epubColors, epubDocumentCss, hostMetrics } from "../lib/epubTheme";
import { clearLegacyBookmarks, loadLegacyBookmarks } from "../lib/localBookmarks";
import {
  excerpt,
  loadHighlights,
  saveHighlights,
  swatchStyles,
  type StoredHighlight,
  type SwatchId,
} from "../lib/highlights";
import { useQueryClient } from "@tanstack/react-query";
import {
  anchorForRect,
  baseHref,
  isNoteref,
  noteContainer,
  noteText,
  NOTE_MAX,
  resolveHref,
  stripChapterNumber,
  wordAtPoint,
} from "../lib/epubDom";
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
import DictionaryPopover, { type DictionaryState } from "./DictionaryPopover";
import { anchorFromFrame } from "./EpubPopover";
import FootnotePopover, { type FootnoteState } from "./FootnotePopover";
import HighlightPopover, { type HighlightPopoverState } from "./HighlightPopover";
import { StatusOverlay } from "./ui/StatusView";
import type {
  BookmarkItem,
  ChapterItem,
  HighlightItem,
  ReaderApi,
  ReaderReportedState,
} from "./readerTypes";

/** Pull the OPF-declared cover out of an EPUB and store it for the shelf. */
async function captureEpubCover(book: EpubBook, id: number) {
  try {
    const url = await book.coverUrl?.();
    if (!url) return;
    const blob = await (await fetch(url)).blob();
    URL.revokeObjectURL(url);
    if (blob.size > 0) await api.captureLocalCover(id, blob);
  } catch {
    /* cosmetic — the gradient fallback is already correct */
  }
}


interface TextReaderProps {
  record: api.WebComicRecord;
  onState: (state: ReaderReportedState) => void;
}

const STYLE_ID = "shelf-epub-style";
const HL_CLASS = "shelf-hl";
const LONG_PRESS_MS = 500;
/** Past this much finger travel the gesture is a scroll or a selection drag,
 *  not a long-press. */
const LONG_PRESS_SLOP = 12;
/** A long-press and a double-click both leave a selection behind, and epub.js
 *  debounces `selected` by 250ms — so without a suppression window the swatch
 *  picker and the dictionary popover both answer the same gesture. */
const SELECT_SUPPRESS_MS = 900;
const TextReader = forwardRef<ReaderApi, TextReaderProps>(function TextReader(
  { record, onState },
  ref,
) {
  const qc = useQueryClient();
  const prefs = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const serverUrl = useSession((s) => s.serverUrl) ?? "";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const cfiRef = useRef<string | null>(record.lastLocation || null);
  const hrefRef = useRef<string>("");
  const closingRef = useRef(false);
  /** Read inside epub.js callbacks that outlive the render they were made in. */
  const fixedRef = useRef(false);
  const highlightsRef = useRef<StoredHighlight[]>([]);
  const suppressSelectRef = useRef(0);
  const pendingTextRef = useRef("");
  const dictAbortRef = useRef<AbortController | null>(null);

  const [toc, setToc] = useState<EpubTocItem[]>([]);
  const [currentHref, setCurrentHref] = useState("");
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
  /** Byte-level progress while open-time Save to device is streaming. */
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  /** Bumped by the Retry affordance to re-run the load effect after a failed
   *  fetch (offline, server hiccup) without leaving the reader. */
  const [reloadNonce, setReloadNonce] = useState(0);
  const bookOpen = load.kind === "ready";
  const [footnote, setFootnote] = useState<FootnoteState | null>(null);
  const [dict, setDict] = useState<DictionaryState | null>(null);
  const [hlPop, setHlPop] = useState<HighlightPopoverState | null>(null);
  highlightsRef.current = highlights;

  const fontId = fontIdFor(prefs, record.id);
  // Two-page only while paginated; scroll mode is always a single column.
  const spreadMode: EpubSpread =
    prefs.flow === "paginated" && prefs.epubColumns === 2 ? "always" : "none";

  /* ------------------------------------------------------------- theming */

  const currentCss = useCallback(() => {
    const p = prefsRef.current;
    const fontSizePx = p.fontScale * 20;
    const scrolledMaxWidthPx =
      p.columnWidth > 0
        ? Math.min(640, Math.round(p.columnWidth * fontSizePx * 0.5))
        : 640;
    return epubDocumentCss({
      theme: p.theme,
      fontId: fontIdFor(p, record.id),
      // Design: reading body = fontScale × 20px. html% is relative to the
      // browser's 16px default, so scale by 20/16 = 125%.
      fontSizePercent: Math.round(p.fontScale * 125),
      lineHeight: p.lineHeight,
      scrolled: p.flow === "scrolled",
      scrolledMargin: p.margin,
      scrolledMaxWidthPx,
    });
  }, [record.id]);

  const injectCss = useCallback(
    (doc: Document | undefined) => {
      // A fixed-layout book positions its own text on its own page boxes; our
      // font, size and background overrides would tear that apart.
      if (fixedRef.current || !doc?.head) return;
      let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
      if (!style) {
        style = doc.createElement("style");
        style.id = STYLE_ID;
      }
      style.textContent = currentCss();
      doc.head.appendChild(style); // (re-)append to keep it last in the cascade
    },
    [currentCss],
  );

  /** Restyle already-rendered sections (pref changes). New sections are styled
   *  by the `content` hook registered at render time. */
  const applyTheme = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    for (const content of rendition.getContents?.() ?? []) {
      injectCss(content.document);
    }
  }, [injectCss]);

  const resizeToHost = useCallback(() => {
    const el = containerRef.current;
    const rendition = renditionRef.current;
    if (!el || !rendition) return;
    try {
      rendition.resize(el.clientWidth, el.clientHeight);
    } catch {
      /* rendition mid-teardown */
    }
  }, []);

  /* ---------------------------------------------------------- highlights */

  /** Repaint every stored highlight. epub.js's `annotations.remove` only tidies
   *  its section index while a view is rendered, and a leaked index entry makes
   *  the render hook throw and silently drop the rest of that section's marks —
   *  so never touch annotations before the first view exists. */
  const paintHighlights = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition || !(rendition.getContents?.() ?? []).length) return;
    const theme = prefsRef.current.theme;
    for (const h of highlightsRef.current) {
      try {
        rendition.annotations.remove(h.cfi, "highlight");
        rendition.annotations.highlight(h.cfi, {}, undefined, HL_CLASS, swatchStyles(h.color, theme));
      } catch {
        /* CFI from another edition of the book — skip that one mark */
      }
    }
  }, []);

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
      try {
        renditionRef.current?.annotations.remove(cfi, "highlight");
      } catch {
        /* never rendered */
      }
      persistHighlights(highlightsRef.current.filter((h) => h.cfi !== cfi));
      setHlPop(null);
    },
    [persistHighlights],
  );

  const addHighlight = useCallback(
    (cfi: string, color: SwatchId, text: string) => {
      const rendition = renditionRef.current;
      const existing = highlightsRef.current.find((h) => h.cfi === cfi);
      const next: StoredHighlight = {
        cfi,
        color,
        text: existing?.text || excerpt(text),
        createdAt: existing?.createdAt ?? Date.now(),
      };
      try {
        // Recoloring is a remove + re-add: `styles` are baked into the mark's
        // SVG attributes when it's created and never revisited.
        rendition?.annotations.remove(cfi, "highlight");
        rendition?.annotations.highlight(
          cfi,
          {},
          undefined,
          HL_CLASS,
          swatchStyles(color, prefsRef.current.theme),
        );
      } catch {
        /* unresolvable range — still store it so the drawer keeps the excerpt */
      }
      persistHighlights([...highlightsRef.current.filter((h) => h.cfi !== cfi), next]);
      setHlPop(null);
    },
    [persistHighlights],
  );

  /* ---------------------------------------------------------- footnotes */

  /** Resolve a noteref's target to previewable text, or null to let epub.js
   *  navigate normally. */
  const resolveNote = useCallback(
    async (sectionHref: string, rawHref: string): Promise<string | null> => {
      const book = bookRef.current;
      if (!book?.spine) return null;
      const full = resolveHref(sectionHref, rawHref);
      const [path, id] = [baseHref(full), full.split("#")[1]];
      if (!id) return null;

      let root: Element | Document | null = null;
      if (path === baseHref(sectionHref)) {
        // Same file: the DOM is already live, and re-loading the section would
        // hand back a detached copy.
        root =
          renditionRef.current
            ?.getContents?.()
            ?.find((c) => c.document?.querySelector(`[id="${CSS.escape(id)}"]`))?.document ?? null;
      }
      if (!root) {
        const section = book.spine.get(path);
        if (!section) return null;
        root = await section.load(book.load.bind(book));
      }

      const target = root.querySelector(`[id="${CSS.escape(id)}"]`);
      if (!target) return null;
      const text = noteText(noteContainer(target));
      if (!text || text.length > NOTE_MAX) return null;
      return text;
    },
    [],
  );

  /* -------------------------------------------------- in-iframe wiring */

  /** Everything interactive inside the book has to be bound per section
   *  document: the reading surface is a sandboxed iframe, so host-page
   *  listeners never see these events. Returns nothing — epub.js discards the
   *  whole document on unload, taking the listeners with it. */
  const wireContents = useCallback(
    (contents: EpubContents) => {
      const doc = contents.document;
      const rendition = renditionRef.current;
      if (!doc || !rendition) return;

      const sectionHref =
        bookRef.current?.spine?.get(contents.sectionIndex ?? 0)?.href ?? hrefRef.current;

      // Capture phase: epub.js's own link handling is an `onclick` on the
      // anchor itself, so stopping propagation here is what keeps a footnote
      // tap from navigating the reader out of the paragraph.
      const onClick = (e: Event) => {
        const target = e.target as Element | null;
        const a = target?.closest?.("a[href]");
        const me = e as MouseEvent;

        if (a && isNoteref(a)) {
          const href = a.getAttribute("href") ?? "";
          if (!href.includes("#") || /^(https?:|mailto:)/i.test(href)) return;

          e.preventDefault();
          e.stopPropagation();

          const label = (a.textContent ?? "").trim() || "Note";
          const anchor = anchorFromFrame(contents.window, me.clientX, me.clientY);
          const full = resolveHref(sectionHref, href);
          void resolveNote(sectionHref, href).then((text) => {
            if (text) setFootnote({ anchor, label, text, target: full });
            // Nothing previewable — honor the link the reader actually tapped.
            else void displayHref(full);
          });
          return;
        }

      };
      doc.addEventListener("click", onClick, true);

      /* Dictionary: long-press on touch, double-click on desktop. */
      const openDict = (word: string, x: number, y: number) => {
        if (!isLookupWord(word)) return;
        suppressSelectRef.current = Date.now() + SELECT_SUPPRESS_MS;
        const anchor = anchorFromFrame(contents.window, x, y);
        setHlPop(null);
        setDict({ anchor, word, result: null });

        dictAbortRef.current?.abort();
        const ctrl = new AbortController();
        dictAbortRef.current = ctrl;
        void lookup(word, ctrl.signal).then((result: DictionaryResult) => {
          if (ctrl.signal.aborted) return;
          setDict((cur) => (cur && cur.word === word ? { ...cur, result } : cur));
        });
      };

      let timer: ReturnType<typeof setTimeout> | null = null;
      let startX = 0;
      let startY = 0;
      const cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      const onTouchStart = (e: Event) => {
        const t = (e as TouchEvent).touches[0];
        if (!t) return;
        startX = t.clientX;
        startY = t.clientY;
        cancel();
        timer = setTimeout(() => {
          const word = wordAtPoint(doc, startX, startY);
          if (word) openDict(word, startX, startY);
        }, LONG_PRESS_MS);
      };
      const onTouchMove = (e: Event) => {
        const t = (e as TouchEvent).touches[0];
        if (!t) return;
        if (Math.abs(t.clientX - startX) > LONG_PRESS_SLOP || Math.abs(t.clientY - startY) > LONG_PRESS_SLOP) {
          cancel();
        }
      };
      const onDblClick = (e: Event) => {
        const me = e as MouseEvent;
        // `getSelection().toString()` is "" (not null) when the double-click
        // selected nothing — `||` so the caret-position fallback actually runs.
        const selected = contents.window?.getSelection?.()?.toString().trim();
        const word = selected || wordAtPoint(doc, me.clientX, me.clientY) || "";
        if (word) openDict(word, me.clientX, me.clientY);
      };

      doc.addEventListener("touchstart", onTouchStart, { passive: true });
      doc.addEventListener("touchmove", onTouchMove, { passive: true });
      doc.addEventListener("touchend", cancel, { passive: true });
      doc.addEventListener("touchcancel", cancel, { passive: true });
      doc.addEventListener("dblclick", onDblClick);
    },
    [resolveNote],
  );

  /* ----------------------------------------------------- load + render */

  useEffect(() => {
    let localBook: EpubBook | null = null;
    let localRendition: EpubRendition | null = null;
    // `load` is async, so the cleanup can fire while it is still awaiting the
    // fetch — at which point `localRendition` is still null and there is nothing
    // for cleanup to destroy. Without this flag the abandoned run goes on to
    // renderTo() the same container anyway and we end up with two live
    // renditions stacked on top of each other (visible immediately under
    // StrictMode's double-mount, and reachable in production any time this
    // effect re-runs mid-load).
    let cancelled = false;
    const teardown = () => {
      try {
        localRendition?.destroy();
      } catch {
        /* mid-render */
      }
      try {
        localBook?.destroy?.();
      } catch {
        /* mid-parse */
      }
      localRendition = null;
      localBook = null;
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
      try {
        // Copies a server book into the local library on the way (see
        // loadBookData) — open it once and it's on your shelf, offline.
        const { data: buffer, localId } = await loadBookData(record);
        if (cancelled) return;
        setDownloadPct(null);
        if (localId != null && record.source !== "local") {
          qc.invalidateQueries({ queryKey: ["local"] });
        }

        localBook = createEpub(buffer);
        bookRef.current = localBook;
        localBook.loaded.navigation.then((nav) => {
          if (!cancelled) setToc(flattenToc(nav.toc));
        });

        // A local EPUB has no cover until someone extracts one, and epub.js has
        // the archive open right here. Once only, off the critical path.
        if (record.source === "local" && !record.hasCover) {
          void captureEpubCover(localBook, record.id);
        }

        // The layout the OPF declares decides how we render, so it has to be
        // known before renderTo — otherwise a fixed-layout book paints as
        // reflowable and re-renders a moment later. Wait on the two promises
        // that answer it rather than `book.ready`, which also awaits navigation
        // and never settles for a book with a broken nav path.
        await Promise.all([localBook.loaded.metadata, localBook.loaded.displayOptions]);
        if (cancelled) return teardown();
        const isFixed = isFixedLayout(localBook);
        fixedRef.current = isFixed;
        setFixed(isFixed);

        const p = prefsRef.current;
        // Two-page requires spread "always" *and* minSpreadWidth 0: epub.js still
        // gates dual columns on width >= minSpreadWidth (default 800), which our
        // single-column viewport (max 640) never reaches.
        const twoCol = !isFixed && p.flow === "paginated" && p.epubColumns === 2;
        const reflowSpread: EpubSpread = twoCol ? "always" : "none";
        localRendition = localBook.renderTo(container, {
          width: "100%",
          height: "100%",
          // The continuous manager accumulates view offsets when it is used
          // with column pagination on iPad, progressively clipping later
          // pages. Give each flow its native manager and rebuild on a flow
          // switch instead.
          manager: isFixed || p.flow === "paginated" ? "default" : "continuous",
          spread: isFixed ? "auto" : reflowSpread,
          minSpreadWidth: twoCol ? 0 : 800,
          flow:
            isFixed
              ? "paginated"
              : p.flow === "scrolled"
                ? "scrolled-continuous"
                : "paginated",
          ...(isFixed ? { layout: "pre-paginated" as const } : {}),
        });
        if (cancelled) return teardown();
        renditionRef.current = localRendition;

        // Style every section document as it attaches — `rendered` fires
        // before getContents() is populated, so a hook is the only reliable
        // way to theme the very first paint.
        localRendition.hooks.content.register((contents) => {
          injectCss(contents.document);
          wireContents(contents);
        });
        localRendition.on("rendered", () => applyTheme());

        localRendition.on("selected", (cfiRange, contents) => {
          if (Date.now() < suppressSelectRef.current) return;
          const sel = contents.window?.getSelection?.();
          const text = sel?.toString() ?? "";
          if (!text.trim()) return;
          const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
          pendingTextRef.current = text;
          setDict(null);
          setHlPop({
            anchor: anchorForRect(contents, range?.getBoundingClientRect()),
            cfiRange,
            existing: highlightsRef.current.find((h) => h.cfi === cfiRange)?.color ?? null,
          });
        });

        localRendition.on("markClicked", (cfiRange, _data, contents) => {
          const found = highlightsRef.current.find((h) => h.cfi === cfiRange);
          if (!found) return;
          pendingTextRef.current = found.text;
          setDict(null);
          setHlPop({
            anchor: anchorForRect(contents, contents.range?.(cfiRange)?.getBoundingClientRect()),
            cfiRange,
            existing: found.color,
          });
        });

        localRendition.on("relocated", (location) => {
          const startCfi = location.start?.cfi;
          const href = location.start?.href;
          if (href) {
            hrefRef.current = href;
            setCurrentHref(href);
          }
          setAtEnd(!!location.atEnd);
          const book = bookRef.current;
          let pct: number | undefined;

          if (fixedRef.current && book?.spine) {
            // A fixed-layout book already has real pages: its spine. The
            // location index would only measure the little text it carries.
            const total = book.spine.length;
            const idx = (book.spine.get(baseHref(href))?.index ?? 0) + 1;
            if (total > 0) {
              pct = Math.round((idx / total) * 100);
              setPercent(pct);
              setPageCount(total);
              setPageNumber(idx);
              setPageLabel(`Page ${idx} of ${total}`);
            }
          } else if (startCfi && book?.locations && book.locations.length() > 0) {
            const frac = book.locations.percentageFromCfi(startCfi);
            if (typeof frac === "number" && !Number.isNaN(frac)) {
              pct = Math.round(frac * 100);
              const n = book.locations.length();
              const idx = Math.min(n, Math.max(1, Math.round(frac * (n - 1)) + 1));
              setPercent(pct);
              setPageCount(n);
              setPageNumber(idx);
              setPageLabel(
                prefsRef.current.flow === "scrolled"
                  ? `Location ${idx} of ${n}`
                  : `Page ${idx} of ${n}`,
              );
            }
          }
          if (startCfi && !closingRef.current) {
            cfiRef.current = startCfi;
            api.scheduleProgress(record, {
              location: startCfi,
              ...(pct != null ? { percent: pct } : {}),
            });
          }
        });

        // A flow switch rebuilds the rendition. Prefer the live location so
        // the new manager opens exactly where the old one was torn down.
        const startCfi = cfiRef.current || record.lastLocation || undefined;
        try {
          await localRendition.display(startCfi);
        } catch {
          cfiRef.current = null;
          await localRendition.display();
        }
        applyTheme();
        paintHighlights();
        setLoad(readyState());

        if (isFixed) {
          // Spine pages are addressable the moment the book is unpacked; there
          // is no index to wait for.
          setCanSeek(true);
          return;
        }

        // Build whole-book location index after first paint for real progress.
        const book = localBook;
        const locations = book.locations;
        if (book.ready && locations) {
          book.ready
            .then(() => locations.generate(1024))
            .then(() => {
              if (closingRef.current) return;
              setCanSeek(true);
              const cfi = cfiRef.current;
              if (!cfi) return;
              const frac = locations.percentageFromCfi(cfi);
              if (typeof frac === "number" && !Number.isNaN(frac)) {
                const pct = Math.round(frac * 100);
                const n = locations.length();
                const idx = Math.min(n, Math.max(1, Math.round(frac * (n - 1)) + 1));
                setPercent(pct);
                setPageCount(n);
                setPageNumber(idx);
                setPageLabel(
                  prefsRef.current.flow === "scrolled"
                    ? `Location ${idx} of ${n}`
                    : `Page ${idx} of ${n}`,
                );
                api.scheduleProgress(record, { location: cfi, percent: pct });
              }
            })
            .catch(() => {});
        }
      } catch (err) {
        setLoad(classifyError(err, "reader"));
      }
    }

    void load();

    // Keep epub.js column pagination in sync with the container box —
    // otherwise a stale measurement bleeds a sliver of the next column in.
    const observer = new ResizeObserver(() => resizeToHost());
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      cancelled = true;
      unlistenProgress?.();
      observer.disconnect();
      closingRef.current = true;
      dictAbortRef.current?.abort();
      void api.flushProgress(record);
      teardown();
      renditionRef.current = null;
      bookRef.current = null;
    };
    // reloadNonce is a deliberate re-trigger for the Retry button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, record.lastLocation, prefs.flow, reloadNonce, applyTheme, injectCss, wireContents, paintHighlights, resizeToHost]);

  /* ------------------------------------------------------ live prefs */

  // Re-apply theme live when prefs change. All styling flows through the
  // injected stylesheet (see injectCss) — epub.js's themes API is bypassed so
  // there is exactly one source of truth. Size changes reflow the columns, so
  // nudge the rendition afterwards.
  useEffect(() => {
    if (!renditionRef.current) return;
    applyTheme();
    resizeToHost();
  }, [prefs.theme, prefs.fontScale, prefs.lineHeight, fontId, applyTheme, resizeToHost]);

  // A highlight's color is frozen into SVG attributes at creation, and the
  // blend mode that reads well on a dark page inverts on a light one — so a
  // theme switch has to repaint every mark.
  useEffect(() => {
    paintHighlights();
  }, [prefs.theme, paintHighlights]);

  // Margin / measure live on the host box, not inside the frame: under column
  // pagination body padding applies once across the whole column set rather
  // than per page. epub.js measured the old box, so re-measure after the
  // browser has laid the new one out. Scrolled mode keeps these values inside
  // its full-surface iframe, so its section stylesheet must also be refreshed.
  useEffect(() => {
    applyTheme();
    resizeToHost();
  }, [prefs.margin, prefs.columnWidth, applyTheme, resizeToHost]);

  // Flow changes rebuild the rendition above because paginated and scrolling
  // EPUBs require different managers. Column-count changes stay live; wait a
  // frame for `.epub-viewport` width to settle before re-measuring.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || fixedRef.current) return;
    try {
      // Second arg is minSpreadWidth — 0 forces dual columns when spread is on
      // (epub.js defaults to 800 and still checks width even for "always").
      rendition.spread(spreadMode, spreadMode === "always" ? 0 : 800);
    } catch {
      /* mid-teardown */
    }
    applyTheme();
    const id = requestAnimationFrame(() => resizeToHost());
    return () => cancelAnimationFrame(id);
  }, [spreadMode, applyTheme, resizeToHost]);

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

      // Hand any pre-server bookmarks over, once. Entries already on the server
      // are skipped so a half-finished earlier run can't duplicate them, and the
      // local copy is only dropped after every write lands — a guest (401) or an
      // offline reader keeps theirs to retry on the next open.
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

  const currentBase = baseHref(currentHref);
  let currentIndex = toc.findIndex((t) => baseHref(t.href) === currentBase);
  if (currentIndex < 0) currentIndex = 0;

  const chapters: ChapterItem[] = toc.map((t, i) => ({
    key: `${t.href}-${i}`,
    num: roman(i),
    title: stripChapterNumber(t.label) || `Section ${i + 1}`,
    target: t.href,
    active: i === currentIndex,
  }));

  const currentChapterTitle = stripChapterNumber(toc[currentIndex]?.label);
  const chapterLabel = toc.length ? `${roman(currentIndex)}.  ${currentChapterTitle}` : "";

  // Bookmarks are shared with comics, which anchor by page; only the ones
  // carrying a CFI belong to this book.
  const locationBookmarks = useMemo(
    () => bookmarks.filter((b): b is api.ServerBookmark & { location: string } => !!b.location),
    [bookmarks],
  );

  const isBookmarked = !!cfiRef.current && locationBookmarks.some((b) => b.location === cfiRef.current);

  /** Navigate to a document href (a TOC entry, or an in-book link).
   *
   *  Everything goes through `spineTargetFor` first: epub.js resolves an
   *  unrecognised href to spine item 0, so a TOC whose hrefs are written
   *  relative to the nav document rather than the OPF sends every entry to
   *  page 1 — silently, and looking for all the world like our bug. */
  const displayHref = useCallback((href: string) => {
    const book = bookRef.current;
    const rendition = renditionRef.current;
    if (!rendition) return;
    const target = book ? spineTargetFor(book, href) : href;
    void rendition.display(target).catch(() => {});
  }, []);

  const toggleBookmark = useCallback(async () => {
    const cfi = cfiRef.current;
    if (!cfi) return;
    const existing = bookmarks.find((b) => b.location === cfi);
    if (existing) {
      setBookmarks((bm) => bm.filter((b) => b.id !== existing.id));
      api.deleteBookmark(record, existing.id).catch(() => {
        setBookmarks((bm) => [...bm, existing]);
      });
    } else {
      try {
        const created = await api.createBookmark(record, { location: cfi });
        setBookmarks((bm) => [...bm, created]);
      } catch {
        /* guest write — silent */
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

  useImperativeHandle(
    ref,
    (): ReaderApi => ({
      next: () => renditionRef.current?.next(),
      prev: () => renditionRef.current?.prev(),
      toggleBookmark: () => void toggleBookmark(),
      goToChapter: (target) => void displayHref(String(target)),
      goToBookmark: (item) => {
        void renditionRef.current?.display(item.target).catch(() => {});
      },
      getPosition: () => cfiRef.current,
      goTo: (target) => {
        void renditionRef.current?.display(target).catch(() => {});
      },
      goToPage: (n) => {
        const book = bookRef.current;
        if (fixedRef.current) {
          void renditionRef.current?.display(n - 1).catch(() => {});
          return;
        }
        // `cfiFromLocation` answers with the number -1 rather than a CFI when
        // the location is out of range; handing that to display() would be read
        // as a spine index.
        const cfi = book?.locations?.cfiFromLocation?.(n - 1);
        if (typeof cfi !== "string") return;
        void renditionRef.current?.display(cfi).catch(() => {});
      },
      goToPercent: (pct) => {
        const book = bookRef.current;
        if (fixedRef.current && book?.spine) {
          const idx = Math.min(
            book.spine.length - 1,
            Math.max(0, Math.round((pct / 100) * (book.spine.length - 1))),
          );
          void renditionRef.current?.display(idx).catch(() => {});
          return;
        }
        // Takes a 0–1 fraction; display() would reject the raw percent as a
        // spine index for whole numbers.
        const cfi = book?.locations?.cfiFromPercentage?.(Math.min(1, Math.max(0, pct / 100)));
        if (typeof cfi !== "string") return;
        void renditionRef.current?.display(cfi).catch(() => {});
      },
      goToHighlight: (item) => {
        void renditionRef.current?.display(item.target).catch(() => {});
      },
      removeHighlight,
    }),
    [toggleBookmark, removeHighlight],
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
    // chapters rebuilt each render; deps below keep it fresh
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

  /* ------------------------------------------------------------ render */

  // A fixed-layout book brings its own page geometry; padding it would just
  // shrink the artwork.
  // Two-page: don't clamp the host to a single-column measure — the pair of
  // columns needs the full widened viewport.
  const twoCol = !fixed && prefs.flow === "paginated" && prefs.epubColumns === 2;
  const scrolled = !fixed && prefs.flow === "scrolled";
  const metrics = fixed || scrolled
    ? { paddingInline: "0px", maxWidth: "none" }
    : twoCol
      ? { paddingInline: `${Math.round(prefs.margin * 100)}%`, maxWidth: "none" as const }
      : hostMetrics(prefs.margin, prefs.columnWidth, prefs.fontScale * 20);

  return (
    <div
      className={`epub-wrap${fixed ? " fixed" : ""}${twoCol ? " two-col" : ""}${scrolled ? " scrolled" : ""}`}
      style={fixed ? undefined : { background: epubColors(prefs.theme).bg }}
    >
      {chapterLabel && !fixed && !scrolled && <div className="chapter-label">{chapterLabel}</div>}
      <div className="epub-viewport">
        {/* The margin box is a wrapper, not the render host: epub.js is handed
            the host's clientWidth, which would still include its own padding
            and overflow the column by exactly that much. */}
        <div
          className="epub-measure"
          style={{ paddingInline: metrics.paddingInline, maxWidth: metrics.maxWidth }}
        >
          <div ref={containerRef} className="epub-host" />
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

      {footnote && (
        <FootnotePopover
          state={footnote}
          onClose={() => setFootnote(null)}
          onOpen={() => {
            void renditionRef.current?.display(footnote.target).catch(() => {});
            setFootnote(null);
          }}
        />
      )}
      {dict && <DictionaryPopover state={dict} onClose={() => setDict(null)} />}
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
