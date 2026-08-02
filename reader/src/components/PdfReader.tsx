/** PDF reader powered by pdf.js. Supports single page, two-page spread, and
 *  continuous vertical scroll — the same layouts comics use (`comicMode`).
 *  Progress + bookmarks stay page-index based so the shell's back-stack and
 *  scrubber work unchanged. */
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
import { roman } from "../lib/format";
import { isRenderCancelled, loadOutline, openPdf } from "../lib/pdf";
import type { PdfOutlineEntry } from "../lib/pdf";
import {
  keepSetFromWindow,
  pagesToRelease,
  pdfMemoryBudget,
  releaseCanvas,
} from "../lib/pdfMemory";
import { useDeviceTransfer } from "../lib/deviceTransfer";
import {
  classifyError,
  loadingState,
  LOAD_MESSAGES,
  readyState,
  type LoadState,
} from "../lib/loadState";
import {
  computeVirtualWindow,
  pageAtScroll,
  PDF_SCROLL_GAP,
  pdfScrollEstHeight,
  windowIndices,
} from "../lib/virtualWindow";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { usePrefs } from "../store/prefs";
import { StatusOverlay } from "./ui/StatusView";
import type {
  BookmarkItem,
  ChapterItem,
  ReaderApi,
  ReaderReportedState,
} from "./readerTypes";

interface PdfReaderProps {
  record: api.WebComicRecord;
  onState: (state: ReaderReportedState) => void;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Render page 1 into a shelf-sized JPEG and hand it to the local catalog. */
async function captureFirstPage(pdf: PDFDocumentProxy, id: number) {
  try {
    const page = await pdf.getPage(1);
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 480 / unscaled.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (blob) await api.captureLocalCover(id, blob);
  } catch {
    /* cosmetic — the gradient fallback is already correct */
  }
}

/** Fit one PDF page into a CSS box and paint it onto `canvas`. */
async function paintPage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  boxW: number,
  boxH: number,
  prevTask: RenderTask | null,
): Promise<RenderTask | null> {
  if (prevTask) {
    prevTask.cancel();
    await prevTask.promise.catch(() => {});
  }
  if (boxW <= 0 || boxH <= 0) return null;

  const pdfPage = await doc.getPage(pageIndex + 1);
  const unscaled = pdfPage.getViewport({ scale: 1 });
  const dpr = window.devicePixelRatio || 1;
  const fit = Math.min(boxW / unscaled.width, boxH / unscaled.height);
  const viewport = pdfPage.getViewport({ scale: fit * dpr });

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

  const task = pdfPage.render({ canvas, viewport });
  await task.promise;
  return task;
}

const PdfReader = forwardRef<ReaderApi, PdfReaderProps>(function PdfReader(
  { record, onState },
  ref,
) {
  const qc = useQueryClient();
  const mode = usePrefs((s) => s.comicMode);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<api.ServerBookmark[]>([]);
  const [load, setLoad] = useState<LoadState>(() =>
    loadingState(LOAD_MESSAGES.loadingPdf),
  );
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const hasDoc = doc != null;
  const [box, setBox] = useState({ width: 0, height: 0 });

  const [page, setPage] = useState(() =>
    record.lastPage != null ? Math.max(0, record.lastPage) : 0,
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasARef = useRef<HTMLCanvasElement | null>(null);
  const canvasBRef = useRef<HTMLCanvasElement | null>(null);
  const scrollCanvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const taskARef = useRef<RenderTask | null>(null);
  const taskBRef = useRef<RenderTask | null>(null);
  const scrollTasks = useRef<Map<number, RenderTask>>(new Map());
  const paintedPages = useRef(new Set<number>());
  const pageRef = useRef(page);
  pageRef.current = page;
  const recordRef = useRef(record);
  recordRef.current = record;
  const firstProgress = useRef(true);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [scrollOffset, setScrollOffset] = useState(0);
  const [scrollViewH, setScrollViewH] = useState(
    typeof window !== "undefined" ? window.innerHeight : 800,
  );
  const memBudget = useMemo(() => pdfMemoryBudget(box.width || undefined), [box.width]);

  const total = Math.max(1, pageCount ?? record.pageCount);
  const step = mode === "spread" ? 2 : 1;
  const isScroll = mode === "scroll";
  const isSpread = mode === "spread";

  const goToIndex = useCallback(
    (i: number) => {
      const next = clamp(Math.round(i), 0, total - 1);
      // In two-page mode land on an even left page so a seek never shows
      // the second half of a spread alone.
      if (modeRef.current === "spread") {
        setPage(next - (next % 2));
      } else {
        setPage(next);
      }
    },
    [total],
  );

  /* -------------------------------------------------------------- load */

  useEffect(() => {
    let alive = true;
    setLoad(loadingState(LOAD_MESSAGES.loadingPdf));
    setDownloadPct(null);
    setDoc(null);
    setPageCount(null);
    setOutline([]);

    let unlisten: (() => void) | null = null;
    if (record.source !== "local" && api.localSupported) {
      // Open-time save uses the same full-file path as “Save to device”.
      useDeviceTransfer.getState().start(record.id, record.title);
    }
    void api
      .onLocalDownloadProgress((p) => {
        if (!alive || p.comicId !== record.id) return;
        if (p.done) {
          setDownloadPct(null);
          qc.invalidateQueries({ queryKey: ["local"] });
          return;
        }
        setDownloadPct(p.total ? Math.round((p.received / p.total) * 100) : 0);
      })
      .then((off) => {
        if (!alive) off();
        else unlisten = off;
      });

    let task: Awaited<ReturnType<typeof openPdf>> | null = null;
    (async () => {
      try {
        const started = await openPdf(recordRef.current);
        if (!alive) {
          started.destroy().catch(() => {});
          return;
        }
        task = started;
        const pdf = await task.promise;
        if (!alive) return;
        setDoc(pdf);
        setPageCount(pdf.numPages);
        setDownloadPct(null);
        setLoad(readyState());
        if (record.source === "local" && !record.hasCover) void captureFirstPage(pdf, record.id);
        const entries = await loadOutline(pdf);
        if (alive) setOutline(entries);
      } catch (err: unknown) {
        if (!alive) return;
        setLoad(classifyError(err, "reader"));
      }
    })();

    return () => {
      alive = false;
      unlisten?.();
      taskARef.current?.cancel();
      taskBRef.current?.cancel();
      for (const t of scrollTasks.current.values()) t.cancel();
      scrollTasks.current.clear();
      setDoc(null);
      task?.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, record.source, reloadNonce, qc]);

  /* -------------------------------------------------------- measure box */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setBox((prev) => {
        const width = el.clientWidth;
        const height = el.clientHeight;
        return prev.width === width && prev.height === height
          ? prev
          : { width, height };
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isScroll]);

  useEffect(() => {
    if (pageCount == null) return;
    setPage((p) => clamp(p, 0, pageCount - 1));
  }, [pageCount]);

  // Mode switch: snap spread pages to even left; scroll jumps to the page.
  useEffect(() => {
    if (mode === "spread") {
      setPage((p) => p - (p % 2));
    }
    if (mode === "scroll" && scrollRef.current) {
      const el = scrollCanvasRefs.current.get(pageRef.current)?.parentElement;
      el?.scrollIntoView({ block: "start" });
    }
  }, [mode]);

  /* ----------------------------------------------- paged render (1 / 2) */

  useEffect(() => {
    if (!doc || isScroll || box.width === 0 || box.height === 0) return;
    let cancelled = false;

    void (async () => {
      try {
        const cols = isSpread && page + 1 < total ? 2 : 1;
        const cellW = (box.width - (cols === 2 ? 12 : 0)) / cols;
        const cellH = box.height;

        const a = canvasARef.current;
        if (a) {
          const task = await paintPage(doc, page, a, cellW, cellH, taskARef.current);
          if (!cancelled) taskARef.current = task;
        }

        const b = canvasBRef.current;
        if (cols === 2 && b) {
          const task = await paintPage(doc, page + 1, b, cellW, cellH, taskBRef.current);
          if (!cancelled) taskBRef.current = task;
        } else if (b) {
          // Clear the right canvas when leaving a two-page view.
          const ctx = b.getContext("2d");
          ctx?.clearRect(0, 0, b.width, b.height);
          b.width = 0;
          b.height = 0;
          b.style.width = "0";
          b.style.height = "0";
        }
        if (!cancelled) setLoad((s) => (s.kind === "ready" ? s : readyState()));
      } catch (err) {
        if (cancelled || isRenderCancelled(err)) return;
        // Keep painted content; only block if we never opened a doc.
        if (!hasDoc) setLoad(classifyError(err, "reader"));
      }
    })();

    return () => {
      cancelled = true;
      taskARef.current?.cancel();
      taskBRef.current?.cancel();
    };
  }, [doc, page, box, isScroll, isSpread, total]);

  const itemH = pdfScrollEstHeight(box.width || 400);
  const scrollWin = useMemo(
    () =>
      computeVirtualWindow({
        total,
        scrollOffset,
        viewportSize: scrollViewH,
        itemSize: itemH,
        gap: PDF_SCROLL_GAP,
        overscan: memBudget.overscan,
      }),
    [total, scrollOffset, scrollViewH, itemH, memBudget.overscan],
  );

  /* ----------------------------------------------- scroll: virtual + paint */

  useEffect(() => {
    if (!doc || !isScroll || box.width === 0) return;
    let cancelled = false;
    const root = scrollRef.current;
    if (!root) return;

    const releaseOutside = (keep: Set<number>) => {
      const drop = pagesToRelease(
        paintedPages.current,
        keep,
        memBudget.maxPaintedPages,
        pageRef.current,
      );
      for (const i of drop) {
        const task = scrollTasks.current.get(i);
        task?.cancel();
        scrollTasks.current.delete(i);
        releaseCanvas(scrollCanvasRefs.current.get(i));
        paintedPages.current.delete(i);
      }
    };

    const paintVisible = async () => {
      const keep = keepSetFromWindow(scrollWin.start, scrollWin.end);
      releaseOutside(keep);

      for (const i of windowIndices(scrollWin)) {
        const canvas = scrollCanvasRefs.current.get(i);
        if (!canvas) continue;
        if (canvas.dataset.painted === "1" && canvas.dataset.w === String(box.width)) {
          paintedPages.current.add(i);
          continue;
        }
        try {
          const prev = scrollTasks.current.get(i) ?? null;
          const estH = itemH;
          const task = await paintPage(doc, i, canvas, box.width, estH, prev);
          if (cancelled) return;
          if (task) scrollTasks.current.set(i, task);
          canvas.dataset.painted = "1";
          canvas.dataset.w = String(box.width);
          paintedPages.current.add(i);
        } catch (err) {
          if (cancelled || isRenderCancelled(err)) continue;
        }
      }
      // Re-enforce budget after paints.
      releaseOutside(keep);
    };

    void paintVisible();
    const onScroll = () => {
      setScrollOffset(root.scrollTop);
      setScrollViewH(root.clientHeight);
      const current = pageAtScroll(root.scrollTop, itemH, PDF_SCROLL_GAP, total);
      if (current !== pageRef.current) setPage(current);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelled = true;
      root.removeEventListener("scroll", onScroll);
    };
  }, [doc, isScroll, box, total, scrollWin, itemH, memBudget.maxPaintedPages]);

  // When jumping to a page in scroll mode, position via estimated stride so we
  // do not depend on every slot being mounted.
  useEffect(() => {
    if (!isScroll) return;
    const root = scrollRef.current;
    if (!root) return;
    const stride = itemH + PDF_SCROLL_GAP;
    const target = page * stride;
    if (Math.abs(root.scrollTop - target) > stride * 1.5) {
      root.scrollTop = target;
      setScrollOffset(target);
    }
  }, [page, isScroll, itemH]);

  /* ---------------------------------------------------- bookmarks / progress */

  useEffect(() => {
    let alive = true;
    api
      .listBookmarks(record)
      .then((bm) => {
        if (alive) setBookmarks(bm.filter((b) => b.page != null));
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

  const toggleBookmark = useCallback(async () => {
    const current = pageRef.current;
    const existing = bookmarks.find((b) => b.page === current);
    if (existing) {
      setBookmarks((bm) => bm.filter((b) => b.id !== existing.id));
      api.deleteBookmark(record, existing.id).catch(() => {
        setBookmarks((bm) => [...bm, existing]);
      });
    } else {
      try {
        const created = await api.createBookmark(record, { page: current });
        setBookmarks((bm) =>
          [...bm, created].sort((a, b) => (a.page ?? 0) - (b.page ?? 0)),
        );
      } catch {
        /* guest write — silent */
      }
    }
  }, [bookmarks, record.id]);

  useImperativeHandle(
    ref,
    (): ReaderApi => ({
      next: () => setPage((p) => clamp(p + step, 0, total - 1)),
      prev: () => setPage((p) => clamp(p - step, 0, total - 1)),
      toggleBookmark: () => void toggleBookmark(),
      goToChapter: (target) => goToIndex(Number(target)),
      goToBookmark: (item) => goToIndex(Number(item.target)),
      getPosition: () => pageRef.current,
      goTo: (target) => goToIndex(Number(target)),
      goToPage: (n) => goToIndex(n - 1),
      goToPercent: (pct) => goToIndex((clamp(pct, 0, 100) / 100) * (total - 1)),
    }),
    [total, goToIndex, toggleBookmark, step],
  );

  const isBookmarked = bookmarks.some((b) => b.page === page);
  const rightPage = isSpread && page + 1 < total ? page + 1 : null;
  const percent = Math.round((((rightPage ?? page) + 1) / total) * 100);
  const pageLabel =
    rightPage != null
      ? `Pages ${page + 1}–${rightPage + 1} / ${total}`
      : `Page ${page + 1} / ${total}`;

  const chapters: ChapterItem[] = useMemo(() => {
    let activeIndex = -1;
    outline.forEach((entry, i) => {
      if (entry.pageIndex <= page) activeIndex = i;
    });
    return outline.map((entry, i) => ({
      key: `${entry.pageIndex}-${i}`,
      num: roman(i),
      title: entry.title,
      target: entry.pageIndex,
      active: i === activeIndex,
    }));
  }, [outline, page]);

  const bookmarkItems: BookmarkItem[] = useMemo(
    () =>
      bookmarks
        .filter((b) => b.page != null)
        .map((b) => ({
          key: String(b.id),
          title: record.title,
          label: `Page ${(b.page as number) + 1}`,
          target: b.page as number,
        })),
    [bookmarks, record.title],
  );

  useEffect(() => {
    onState({
      pageLabel,
      percent,
      chapters,
      hasContents: chapters.length > 0,
      isBookmarked,
      bookmarks: bookmarkItems,
      highlights: [],
      pageCount: total,
      pageNumber: page + 1,
      canSeek: true,
      atEnd: total > 0 && (rightPage ?? page) + 1 >= total,
      bottomExtra: null,
    });
  }, [
    onState,
    pageLabel,
    percent,
    chapters,
    isBookmarked,
    bookmarkItems,
    total,
    page,
    rightPage,
  ]);

  const setScrollCanvas = useCallback((i: number, el: HTMLCanvasElement | null) => {
    if (el) scrollCanvasRefs.current.set(i, el);
    else scrollCanvasRefs.current.delete(i);
  }, []);

  return (
    <div className={`pdf-wrap${isScroll ? " pdf-scroll-mode" : ""}${isSpread ? " pdf-spread-mode" : ""}`}>
      {isScroll ? (
        <div className="pdf-scroll" ref={(el) => {
          scrollRef.current = el;
          // containerRef still drives width measurement for page fit.
          (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          if (el) setScrollViewH(el.clientHeight);
        }}>
          {scrollWin.beforePx > 0 && (
            <div
              className="pdf-scroll-spacer"
              style={{ height: scrollWin.beforePx, width: "100%", flex: "none" }}
              aria-hidden
            />
          )}
          {windowIndices(scrollWin).map((i) => (
            <div
              key={i}
              className="pdf-scroll-page"
              data-page={i + 1}
              style={{ minHeight: itemH, width: "100%" }}
            >
              <canvas
                className="pdf-canvas"
                ref={(el) => setScrollCanvas(i, el)}
              />
            </div>
          ))}
          {scrollWin.afterPx > 0 && (
            <div
              className="pdf-scroll-spacer"
              style={{ height: scrollWin.afterPx, width: "100%", flex: "none" }}
              aria-hidden
            />
          )}
        </div>
      ) : (
        <div className="pdf-viewport" ref={containerRef}>
          <canvas ref={canvasARef} className="pdf-canvas" />
          {isSpread && rightPage != null && (
            <canvas ref={canvasBRef} className="pdf-canvas" />
          )}
        </div>
      )}
      {/* Block only when nothing useful is on screen. */}
      {!hasDoc && (
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
    </div>
  );
});

export default PdfReader;
