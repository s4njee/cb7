/** Comic reader — single / two-page / continuous-scroll layouts backed by real
 *  page images, with preloading, a thumbnail strip, and server-side progress + bookmarks. */
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
import {
  COMIC_SCROLL_EST_HEIGHT,
  COMIC_SCROLL_GAP,
  computeVirtualWindow,
  pageAtScroll,
  THUMB_STRIDE,
  THUMB_WIDTH,
  windowIndices,
} from "../lib/virtualWindow";
import { usePrefs } from "../store/prefs";
import { MediaPlaceholder } from "./ui/StatusView";
import type {
  BookmarkItem,
  ReaderApi,
  ReaderReportedState,
} from "./readerTypes";

function PageImage({
  record,
  index,
  aspect,
  width,
  scrollSlot,
}: {
  record: api.WebComicRecord;
  index: number;
  /** Measured intrinsic ratio, once probed. Drives the box for wide pages so a
   *  scanned double-page spread isn't squeezed into the portrait 2/3 frame. */
  aspect?: number;
  /** Resize width bucket to request from the server (CSS px × DPR, bucketed).
   *  Undefined ⇒ full-res. */
  width?: number;
  /** Continuous mode: reserve estimated height for virtual-window spacers. */
  scrollSlot?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  // A transient network/cache miss shouldn't strand a page on the striped
  // placeholder forever — retry once with a cache-busting param before giving up.
  const [retry, setRetry] = useState(0);
  const wide = aspect != null && aspect > 1;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  // A bucket upgrade (rotation / resize) swaps the src; clear the failure latch
  // so the higher-res variant gets its own fresh attempt.
  useEffect(() => {
    setErrored(false);
    setLoaded(false);
    setRetry(0);
  }, [record.id, index, width]);

  const base = api.pageUrl(record, index, width);
  const src =
    retry > 0
      ? `${base}${base.includes("?") ? "&" : "?"}retry=${retry}`
      : base;

  const manualRetry = () => {
    setErrored(false);
    setLoaded(false);
    setRetry((n) => n + 1);
  };

  return (
    <div
      className={`comic-page${wide ? " wide" : ""}`}
      style={{
        ...(wide ? { aspectRatio: String(aspect) } : undefined),
        ...(scrollSlot
          ? { minHeight: COMIC_SCROLL_EST_HEIGHT, boxSizing: "border-box" as const }
          : undefined),
        position: "relative",
      }}
    >
      {!errored && (
        <img
          src={src}
          alt={`Page ${index + 1}`}
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          onError={() => {
            // Auto-retry once, then surface an inline Retry control.
            if (retry < 1) setRetry(1);
            else setErrored(true);
          }}
        />
      )}
      {(!loaded || errored) && (
        <MediaPlaceholder
          label={`PAGE ${String(index + 1).padStart(2, "0")}`}
          failed={errored}
          offline={offline}
          onRetry={errored ? manualRetry : undefined}
        />
      )}
    </div>
  );
}

/** Server-side resize variants are bounded to this ladder so the cache doesn't
 *  fill with a distinct width per device. Requests are bucketed UP to the next
 *  rung and capped at the top. */
const WIDTH_BUCKETS = [480, 768, 1080, 1440, 2048, 2560] as const;
const MAX_BUCKET = 2560;

function bucketWidth(cssWidth: number, dpr: number): number {
  const need = Math.ceil(cssWidth * dpr);
  for (const b of WIDTH_BUCKETS) if (b >= need) return b;
  return MAX_BUCKET;
}

interface ComicReaderProps {
  record: api.WebComicRecord;
  onState: (state: ReaderReportedState) => void;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

const ComicReader = forwardRef<ReaderApi, ComicReaderProps>(function ComicReader(
  { record, onState },
  ref,
) {
  const total = Math.max(1, record.pageCount);
  const mode = usePrefs((s) => s.comicMode);
  const rtl = usePrefs((s) => s.rtl);

  const initialPage =
    record.lastPage != null ? clamp(record.lastPage, 0, total - 1) : 0;
  // Resume on the even-parity anchor: nothing is probed yet, so this is the same
  // guess `anchorFor` makes, and it keeps a resumed spread where it was left.
  const [page, setPage] = useState(() =>
    usePrefs.getState().comicMode === "spread" && initialPage % 2 === 1
      ? initialPage - 1
      : initialPage,
  );
  const [bookmarks, setBookmarks] = useState<api.ServerBookmark[]>([]);

  /** Intrinsic width/height ratio per page index, filled in lazily. A book runs
   *  to hundreds of pages, so we never probe past the reading window. */
  const [aspects, setAspects] = useState<Record<number, number>>({});
  const probed = useRef(new Set<number>());

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const thumbStripRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);
  const firstProgress = useRef(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [scrollViewH, setScrollViewH] = useState(
    typeof window !== "undefined" ? window.innerHeight : 800,
  );
  const [thumbScroll, setThumbScroll] = useState(0);
  const [thumbViewW, setThumbViewW] = useState(320);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  /** Rendered size of the page stage, in CSS px. Seeded from the viewport so the
   *  very first page never has to request full-res while waiting to measure. */
  const [stage, setStage] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1024,
    h: typeof window !== "undefined" ? window.innerHeight : 768,
  }));

  /** Highest width bucket requested per page. Rotation/resize may enlarge the
   *  slot — we upgrade to the bigger variant, but never downgrade mid-session
   *  (that would re-fetch a smaller image over one already cached and shown). */
  const requestedBucket = useRef<Map<number, number>>(new Map());

  /** Known spread boundaries, ascending — every entry is the first page of a
   *  spread. Paging walks this list instead of recomputing pairing from page 0,
   *  which would mean probing every page in between.
   *
   *  INVARIANT: for consecutive entries b[i] < b[i+1], b[i+1] === b[i] + size(b[i]),
   *  so the spreads tile [b[0], frontier) with no page skipped and none shown
   *  twice. Only a seek may break the chain, and a seek resets the list to the
   *  single anchor it lands on — re-anchoring, never leaving a hole. */
  const bounds = useRef<number[]>([]);

  const isWide = useCallback(
    // Unknown pages are assumed portrait: that's the overwhelming majority, and
    // a probe that lands late self-corrects on the next render.
    (i: number) => (aspects[i] ?? 0) > 1,
    [aspects],
  );

  /** Pages in the spread starting at `a`: a landscape page is already a scanned
   *  double-page, so it stands alone, and it also refuses to be anyone's partner. */
  const spreadSize = useCallback(
    (a: number) => (a + 1 < total && !isWide(a) && !isWide(a + 1) ? 2 : 1),
    [total, isWide],
  );

  const probe = useCallback(
    (i: number) => {
      if (i < 0 || i >= total || probed.current.has(i)) return;
      probed.current.add(i);
      const img = new Image();
      // The 96px rendition is what the thumb strip already fetched, so this is
      // usually a cache hit; resizes are width-based and keep the ratio.
      img.onload = () =>
        setAspects((a) => ({ ...a, [i]: img.naturalWidth / img.naturalHeight }));
      img.onerror = () => probed.current.delete(i);
      img.src = api.pageUrl(record, i, 96);
    },
    [record.id, total],
  );

  /** Where a seek to `p` should anchor its spread. Even-parity pairing is the
   *  default so a book without wide pages pairs exactly as it always did; we only
   *  pull `p` back onto its partner when both are known-portrait, otherwise the
   *  page the user asked for could end up outside the spread we render. */
  const anchorFor = useCallback(
    (p: number) => {
      if (mode !== "spread") return p;
      if (p % 2 === 1 && !isWide(p) && !isWide(p - 1)) return p - 1;
      return p;
    },
    [mode, isWide],
  );

  const seek = useCallback(
    (p: number) => {
      const a = anchorFor(clamp(p, 0, total - 1));
      bounds.current = [a];
      setPage(a);
    },
    [anchorFor, total],
  );

  // `seek` re-identifies whenever a probe lands; the thumb strip is one button
  // per page, so it reads through this instead of rebuilding hundreds of nodes.
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const seekStable = useCallback((p: number) => seekRef.current(p), []);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (mode !== "spread") {
        setPage((p) => clamp(p + dir, 0, total - 1));
        return;
      }
      const list = bounds.current;
      let i = list.indexOf(page);
      if (i < 0) {
        // Lost the chain (mode switch, resume): re-anchor here and rebuild.
        list.length = 0;
        list.push(page);
        i = 0;
      }
      if (dir === 1) {
        const nextA = i + 1 < list.length ? list[i + 1] : page + spreadSize(page);
        if (nextA >= total) return;
        if (i + 1 >= list.length) list.push(nextA);
        setPage(nextA);
      } else {
        if (i > 0) {
          setPage(list[i - 1]);
          return;
        }
        if (page <= 0) return;
        // No recorded predecessor, so pair backwards greedily. It can disagree
        // with a scan from page 0, but it never skips or duplicates a page — and
        // once recorded, paging forward retraces exactly these boundaries.
        const prevA =
          isWide(page - 1) || page - 2 < 0 || isWide(page - 2) ? page - 1 : page - 2;
        list.unshift(prevA);
        setPage(prevA);
      }
    },
    [mode, total, page, spreadSize, isWide],
  );

  /** Pages of the current spread, ascending (reading order). RTL only reverses
   *  the visual axis in CSS, so these indices stay in reading order throughout. */
  const spreadPages = useMemo(() => {
    if (mode === "scroll") return [];
    if (mode !== "spread") return [page];
    return spreadSize(page) === 2 ? [page, page + 1] : [page];
  }, [mode, page, spreadSize]);

  const inCurrent = useCallback(
    (i: number) => spreadPages.includes(i),
    [spreadPages],
  );

  // Track the rendered stage box so page requests can be width-hinted to what
  // actually shows on screen — full-res scans are wasteful over LAN and bloat
  // the on-disk media cache. Re-attaches when the wrapper element swaps
  // (scroll ⇄ paged).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () =>
      setStage((prev) => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        return prev.w === w && prev.h === h ? prev : { w, h };
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  /** CSS width of page `i`'s slot, mirroring the layout the stylesheet lays out:
   *  a scroll page is width-capped; a paged page is height-driven (its box is
   *  the stage height, capped at 640px, times the page ratio) but never wider
   *  than the share of the stage its spread column gets. Using the measured
   *  ratio when known keeps a wide (double-page) scan from being under-requested
   *  on the portrait 2/3 assumption. */
  const slotCssWidth = useCallback(
    (i: number): number => {
      if (mode === "scroll") {
        // .comic-scroll .comic-page { width: 460px; max-width: 80% }
        const w = Math.min(460, (stage.w || 460) * 0.8);
        return w > 0 ? w : 460;
      }
      const contentH = stage.h > 0 ? Math.max(0, stage.h - 160) : 0; // padding 70+90
      const pageH = Math.min(contentH || 640, 640);
      const ratio = (aspects[i] ?? 2 / 3) || 2 / 3;
      const wide = (aspects[i] ?? 0) > 1;
      const n = mode === "spread" && !wide ? 2 : 1;
      const heightConstrained = pageH * ratio;
      const contentW = stage.w > 0 ? Math.max(0, stage.w - 80 - (n - 1) * 10) : 0; // padding 40*2, gap 10
      const widthConstrained = contentW > 0 ? contentW / n : Infinity;
      const w = Math.min(heightConstrained, widthConstrained);
      return Number.isFinite(w) && w > 0 ? w : heightConstrained || 768;
    },
    [mode, stage.w, stage.h, aspects],
  );

  /** Width bucket to request for page `i`, upgrade-only. `upscale` pages are
   *  intentionally left un-hinted (full-res per server semantics) — but the
   *  reader exposes no upscale pref today, so nothing takes that branch yet. */
  const pageWidth = useCallback(
    (i: number): number => {
      const want = bucketWidth(slotCssWidth(i), dpr);
      const prev = requestedBucket.current.get(i) ?? 0;
      const next = Math.max(prev, want);
      if (next !== prev) requestedBucket.current.set(i, next);
      return next;
    },
    [slotCssWidth, dpr],
  );

  useImperativeHandle(
    ref,
    (): ReaderApi => ({
      // next/prev are GEOMETRIC, not narrative: the shell wires `next` to the
      // right tap zone / ArrowRight / leftward swipe and `prev` to their mirrors,
      // and those are facts about the screen, not about the story. So in manga we
      // swap which one advances — the LEFT arrow, left tap zone and rightward
      // swipe move the story forward, matching where the next page actually sits.
      next: () => step(rtl ? -1 : 1),
      prev: () => step(rtl ? 1 : -1),
      goToChapter: () => {},
      goToBookmark: (item) => seek(Number(item.target)),
      toggleBookmark: () => void toggleBookmark(),
      getPosition: () => page,
      goTo: (target) => seek(Number(target)),
      goToPage: (n) => seek(n - 1),
      goToPercent: (pct) => seek(Math.round((clamp(pct, 0, 100) / 100) * total) - 1),
    }),
    // toggleBookmark captured below; deps kept minimal by design
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, seek, rtl, total, bookmarks, page],
  );

  // Load bookmarks once (server-side, or the on-device list for a local book).
  useEffect(() => {
    let alive = true;
    api
      .listBookmarks(record)
      .then((bm) => {
        if (alive) setBookmarks(bm);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [record.id]);

  // Debounced progress; flush on unmount so the final page is never lost.
  useEffect(() => {
    if (firstProgress.current) {
      firstProgress.current = false;
      return;
    }
    api.scheduleProgress(record, { page });
  }, [record.id, page]);

  useEffect(() => {
    return () => {
      void api.flushProgress(record);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id]);

  // Preload current ±2 pages at the same width bucket they'll render at, so the
  // prefetch warms the exact cache entry the page will ask for (not a full-res
  // one that then goes unused).
  useEffect(() => {
    for (let d = -2; d <= 2; d++) {
      const i = page + d;
      if (i >= 0 && i < total) {
        const img = new Image();
        img.src = api.pageUrl(record, i, pageWidth(i));
      }
    }
  }, [record.id, page, total, pageWidth]);

  // Probe the reading window ahead of the user so pairing is already settled by
  // the time they page into it; a page that resolves late just re-renders.
  useEffect(() => {
    if (mode !== "spread") return;
    for (let i = page - 2; i <= page + 3; i++) probe(i);
  }, [mode, page, probe]);

  // A mode switch invalidates the boundaries the other layout recorded.
  useEffect(() => {
    bounds.current = [];
  }, [mode]);

  // Keep the active thumbnail in view.
  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [page, mode]);

  async function toggleBookmark() {
    const existing = bookmarks.find((b) => b.page === page);
    if (existing) {
      setBookmarks((bm) => bm.filter((b) => b.id !== existing.id));
      api.deleteBookmark(record, existing.id).catch(() => {
        setBookmarks((bm) => [...bm, existing]);
      });
    } else {
      try {
        const created = await api.createBookmark(record, { page });
        setBookmarks((bm) =>
          [...bm, created].sort((a, b) => (a.page ?? 0) - (b.page ?? 0)),
        );
      } catch {
        /* guest write — silent */
      }
    }
  }

  const isBookmarked = bookmarks.some((b) => b.page === page);
  // Progress uses the furthest visible page in a spread so % matches the label.
  const visibleEnd = spreadPages[spreadPages.length - 1] ?? page;
  const percent = Math.round(((visibleEnd + 1) / total) * 100);
  // Always document order (page N–M), never visual RTL order — the stage flips
  // in CSS; chrome stays numerically progressive.
  const pageLabel =
    mode === "spread" && spreadPages.length === 2
      ? `Pages ${spreadPages[0] + 1}–${spreadPages[1] + 1} / ${total}`
      : `Page ${page + 1} / ${total}`;

  const bookmarkItems: BookmarkItem[] = useMemo(
    () =>
      bookmarks
        // A bookmark may be anchored by an EPUB location instead; a comic never
        // is, but the shape allows it, so drop anything without a page.
        .filter((b): b is api.ServerBookmark & { page: number } => b.page != null)
        .map((b) => ({
          key: String(b.id),
          title: record.title,
          label: `Page ${b.page + 1}`,
          target: b.page,
        })),
    [bookmarks, record.title],
  );

  // Virtualized thumbnail strip: only mount thumbs near the scroll position
  // (plus overscan). Spacers keep total scroll width stable for 1,000+ pages.
  const thumbWin = useMemo(
    () =>
      computeVirtualWindow({
        total,
        scrollOffset: thumbScroll,
        viewportSize: thumbViewW,
        itemSize: THUMB_WIDTH,
        gap: THUMB_STRIDE - THUMB_WIDTH,
        overscan: 12,
      }),
    [total, thumbScroll, thumbViewW],
  );

  const bottomExtra = useMemo(
    () => (
      <div
        className={`thumb-strip${rtl ? " rtl" : ""}`}
        ref={(el) => {
          thumbStripRef.current = el;
          if (el) setThumbViewW(el.clientWidth || 320);
        }}
        onScroll={(e) => setThumbScroll((e.target as HTMLDivElement).scrollLeft)}
      >
        {thumbWin.beforePx > 0 && (
          <div
            className="thumb-spacer"
            style={{ width: thumbWin.beforePx, flex: "none" }}
            aria-hidden
          />
        )}
        {windowIndices(thumbWin).map((i) => {
          const active = inCurrent(i);
          return (
            <button
              key={i}
              ref={active ? activeThumbRef : undefined}
              className={`thumb${active ? " active" : ""}`}
              onClick={() => seekStable(i)}
              aria-label={`Go to page ${i + 1}`}
            >
              <img
                src={api.pageUrl(record, i, 96)}
                alt=""
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </button>
          );
        })}
        {thumbWin.afterPx > 0 && (
          <div
            className="thumb-spacer"
            style={{ width: thumbWin.afterPx, flex: "none" }}
            aria-hidden
          />
        )}
      </div>
    ),
    [total, inCurrent, record.id, rtl, seekStable, thumbWin],
  );

  // Continuous-scroll virtual window (estimated page height).
  const scrollWin = useMemo(
    () =>
      computeVirtualWindow({
        total,
        scrollOffset,
        viewportSize: scrollViewH,
        itemSize: COMIC_SCROLL_EST_HEIGHT,
        gap: COMIC_SCROLL_GAP,
        overscan: 3,
      }),
    [total, scrollOffset, scrollViewH],
  );

  useEffect(() => {
    if (mode !== "scroll") return;
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      setScrollOffset(root.scrollTop);
      setScrollViewH(root.clientHeight);
      const next = pageAtScroll(
        root.scrollTop,
        COMIC_SCROLL_EST_HEIGHT,
        COMIC_SCROLL_GAP,
        total,
      );
      setPage((p) => (p === next ? p : next));
    };
    setScrollViewH(root.clientHeight);
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [mode, total]);

  // Seek/jump in scroll mode: position the virtual window near the target page.
  useEffect(() => {
    if (mode !== "scroll") return;
    const root = scrollRef.current;
    if (!root) return;
    const stride = COMIC_SCROLL_EST_HEIGHT + COMIC_SCROLL_GAP;
    const target = page * stride;
    if (Math.abs(root.scrollTop - target) > stride * 2) {
      root.scrollTop = target;
      setScrollOffset(target);
    }
  }, [mode, page]);

  // Report state up whenever anything relevant changes.
  useEffect(() => {
    onState({
      pageLabel,
      percent,
      chapters: [],
      hasContents: false,
      isBookmarked,
      bookmarks: bookmarkItems,
      highlights: [],
      pageCount: total,
      pageNumber: page + 1,
      canSeek: true,
      // The last page can be visible while page < total-1 (it's the trailing
      // half of a spread), so count the whole visible run.
      atEnd: page + (mode === "spread" ? spreadSize(page) : 1) >= total,
      bottomExtra,
    });
  }, [
    onState,
    pageLabel,
    percent,
    isBookmarked,
    bookmarkItems,
    bottomExtra,
    total,
    page,
    mode,
    spreadSize,
  ]);

  if (mode === "scroll") {
    return (
      <div
        className="comic-scroll"
        ref={(el) => {
          scrollRef.current = el;
          stageRef.current = el;
        }}
      >
        {scrollWin.beforePx > 0 && (
          <div
            className="comic-scroll-spacer"
            style={{ height: scrollWin.beforePx, width: "100%", flex: "none" }}
            aria-hidden
          />
        )}
        {windowIndices(scrollWin).map((i) => (
          <PageImage
            key={i}
            record={record}
            index={i}
            width={pageWidth(i)}
            scrollSlot
          />
        ))}
        {scrollWin.afterPx > 0 && (
          <div
            className="comic-scroll-spacer"
            style={{ height: scrollWin.afterPx, width: "100%", flex: "none" }}
            aria-hidden
          />
        )}
      </div>
    );
  }

  return (
    <div className={`comic-paged${rtl ? " rtl" : ""}`} ref={stageRef}>
      {spreadPages.map((i) => (
        <PageImage
          key={i}
          record={record}
          index={i}
          width={pageWidth(i)}
          // Wide-page fitting is a spread-mode concern only: alone on the stage
          // there's nothing for a landscape page to desynchronise.
          aspect={mode === "spread" ? aspects[i] : undefined}
        />
      ))}
    </div>
  );
});

export default ComicReader;
