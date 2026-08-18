/** Reader shell: owns chrome (top bar, side arrows, bottom bar), tap zones,
 *  keyboard + swipe paging, seeking, the jump back-stack, and the settings /
 *  TOC drawers. The concrete comic / text / pdf reader is mounted inside and
 *  drives its own content. */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as api from "../lib/api";
import { sourceChromeLabel } from "../lib/bookContext";
import { metaLine, readerFormat } from "../lib/format";
import { applyImmersive } from "../lib/immersive";
import { hapticForTurn, type TurnState } from "../lib/haptics";
import { loadGuestProgress } from "../lib/guestProgress";
import { LOAD_MESSAGES } from "../lib/loadState";
import { scrubPreview } from "../lib/scrubPreview";
import { startSession, type ReadingSession } from "../lib/stats";
import { usePrefs } from "../store/prefs";
import { useSession } from "../store/session";
// Lazy so heavy engines (Readium EPUB, pdf.js, comic pages) stay out of the
// initial bundle. EPUB uses Readium TS Toolkit; PDF stays on pdf.js.
const ComicReader = lazy(() => import("./ComicReader"));
const PdfReader = lazy(() => import("./PdfReader"));
const TextReader = lazy(() => import("./TextReader"));
import { ErrorBoundary } from "./ErrorBoundary";
import SettingsDrawer from "./SettingsDrawer";
import SearchDrawer from "./SearchDrawer";
import TocDrawer, { type TocTab } from "./TocDrawer";
import FinishedOverlay from "./flows/FinishedOverlay";
import { RibbonIcon } from "./icons";
import {
  EMPTY_READER_STATE,
  type ReaderApi,
  type ReaderReportedState,
} from "./readerTypes";

type Panel = null | "settings" | "toc" | "search";

/** Deep jumps we can return from. Bounded because a reader who taps through a
 *  hundred footnotes doesn't want a hundred-deep back-stack — they want the
 *  last few places they actually were. */
const MAX_BACK = 32;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export default function Reader({ record: listRecord }: { record: api.WebComicRecord }) {
  const closeReader = useSession((s) => s.closeReader);
  const showToast = useSession((s) => s.showToast);
  const guest = useSession((s) => s.guest);
  const serverUrl = useSession((s) => s.serverUrl) ?? "";
  const readerSettingsTick = useSession((s) => s.readerSettingsTick);
  const readerSearchTick = useSession((s) => s.readerSearchTick);
  const openTarget = useSession((s) => s.openTarget);
  const clearOpenTarget = useSession((s) => s.clearOpenTarget);
  const comicMode = usePrefs((s) => s.comicMode);
  const immersive = usePrefs((s) => s.immersive);
  const haptics = usePrefs((s) => s.haptics);
  const flow = usePrefs((s) => s.flow);

  // A crash inside the mounted sub-reader must not white-screen the whole app.
  // Drop back to the library (which unmounts this Reader) and say so, rather
  // than leaving a dead reader shell around a broken content view.
  const onReaderCrash = useCallback(() => {
    showToast("This book couldn’t be opened.");
    closeReader();
  }, [showToast, closeReader]);

  // The library list may be stale; restoring position from it would overwrite
  // newer progress written from another device. Always refetch on open (the
  // first-party SPA does the same with staleTime 0).
  const freshQuery = useQuery({
    // Server records are addressed *per server* — the same comic id exists on
    // every library — while a local record is device-wide.
    queryKey: ["comic", listRecord.source ?? "server", listRecord.source === "local" ? "" : serverUrl, listRecord.id],
    queryFn: () => api.refreshRecord(listRecord),
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });

  // Guests can't write progress to the server, so the freshest position is the
  // on-device stash — overlay it before the sub-reader restores.
  const record = useMemo(() => {
    const base = freshQuery.data ?? (freshQuery.isError ? listRecord : null);
    // Guest progress is a *server* stash; a local book keeps its own.
    if (!base || !guest || base.source === "local") return base;
    const local = loadGuestProgress(serverUrl, base.id);
    if (!local) return base;
    return {
      ...base,
      ...(local.page !== undefined ? { lastPage: local.page } : {}),
      ...(local.location !== undefined ? { lastLocation: local.location } : {}),
      ...(local.percent !== undefined ? { lastPercent: local.percent } : {}),
    };
  }, [freshQuery.data, freshQuery.isError, listRecord, guest, serverUrl]);

  const shown = record ?? listRecord;
  const format = readerFormat(shown);
  const isComic = format === "comic";
  // Comics and PDFs share comicMode; reflowable EPUBs own a separate flow
  // preference. Scroll mode must be known here as well as in the sub-reader:
  // the shell otherwise leaves its full-screen paging overlay above epub.js,
  // preventing the iPad drag gesture from reaching the actual scroll surface.
  const scrollMode =
    format === "epub"
      ? flow === "scrolled"
      : (format === "comic" || format === "pdf") && comicMode === "scroll";
  const paged = !scrollMode;

  const apiRef = useRef<ReaderApi | null>(null);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [tocTab, setTocTab] = useState<TocTab>(isComic ? "bookmarks" : "contents");
  const [rstate, setRstate] = useState<ReaderReportedState>(EMPTY_READER_STATE);

  // Live position tracking so mode switches remount at the exact current position
  const liveRecord = useMemo(() => {
    const base = record ?? listRecord;
    const pNum = rstate.pageNumber;
    const pIdx = pNum != null ? pNum - 1 : base.lastPage;
    const loc =
      typeof rstate.pageNumber === "number"
        ? null
        : (apiRef.current?.getPosition() as string | null);
    return {
      ...base,
      ...(pIdx != null ? { lastPage: pIdx } : {}),
      ...(loc ? { lastLocation: loc } : {}),
      ...(rstate.percent != null ? { lastPercent: rstate.percent } : {}),
    };
  }, [record, listRecord, rstate.pageNumber, rstate.percent]);
  const [seekOpen, setSeekOpen] = useState(false);

  // Native menu "View > Reader Settings…" bumps this tick; open the drawer.
  useEffect(() => {
    if (readerSettingsTick > 0) setPanel("settings");
  }, [readerSettingsTick]);

  // Native menu "Edit > Find in Library…" (Cmd/Ctrl+F) routes here while
  // reading; open the in-book search drawer.
  useEffect(() => {
    if (readerSearchTick > 0) setPanel("search");
  }, [readerSearchTick]);

  /** Latest reported state, readable inside stable callbacks. */
  const rstateRef = useRef<ReaderReportedState>(EMPTY_READER_STATE);
  const report = useCallback((s: ReaderReportedState) => {
    rstateRef.current = s;
    setRstate(s);
  }, []);

  const toggleChrome = useCallback(() => setChrome((c) => !c), []);

  /* -------------------------------------------------------- finished flow */

  const [finished, setFinished] = useState(false);
  const finishedShownRef = useRef(false);
  useEffect(() => {
    finishedShownRef.current = false;
    setFinished(false);
  }, [shown.id]);

  // Turning "past" the final page is the finish gesture: the reader reports
  // the last page visible (atEnd) and asks for another. Fire once per open.
  const next = useCallback(() => {
    if (rstateRef.current.atEnd && !finishedShownRef.current) {
      finishedShownRef.current = true;
      setFinished(true);
      return;
    }
    apiRef.current?.next();
  }, []);
  const prev = useCallback(() => apiRef.current?.prev(), []);

  /* --------------------------------------------- stats session + history */

  const sessionRef = useRef<ReadingSession | null>(null);
  useEffect(() => {
    const session = startSession(serverUrl, shown.id, shown.title);
    sessionRef.current = session;
    api.beginReadingSession(shown);
    void api.postHistory(shown, "opened", shown.lastPage);
    const onVisibility = () =>
      session.setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      session.stop();
      sessionRef.current = null;
      void api.flushProgress(shown);
      api.endReadingSession(shown);
      const page = rstateRef.current.pageNumber;
      void api.postHistory(shown, "closed", page != null ? page - 1 : null);
    };
    // Track per open book; title/server changes only ever accompany an id change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.id]);

  // Offline progress + bookmark outboxes: retry when the network returns or
  // the app wakes. Bookmarks also flush leftover guest rows after a sign-in.
  useEffect(() => {
    if (shown.source === "local") return;
    const kick = () => {
      if (!guest) void api.syncProgressOutbox();
      void api.syncBookmarksOutbox();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") kick();
    };
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVis);
    kick();
    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [guest, shown.source, shown.id, serverUrl]);

  /* -------------------------------------------------- pace + time-left */

  const paceRef = useRef<{ lastPage: number | null; lastAt: number; emaMs: number | null }>({
    lastPage: null,
    lastAt: 0,
    emaMs: null,
  });
  const [paceMs, setPaceMs] = useState<number | null>(null);

  useEffect(() => {
    paceRef.current = { lastPage: null, lastAt: 0, emaMs: null };
    setPaceMs(null);
  }, [shown.id]);

  useEffect(() => {
    const page = rstate.pageNumber;
    if (page == null) return;
    const pace = paceRef.current;
    const now = Date.now();
    if (pace.lastPage != null && page > pace.lastPage) {
      sessionRef.current?.onPageAdvance();
      const dt = now - pace.lastAt;
      // Ignore instant jumps (scrub/goto) and long idles — neither is reading pace.
      if (dt > 500 && dt < 3 * 60 * 1000) {
        const perPage = dt / (page - pace.lastPage);
        pace.emaMs = pace.emaMs == null ? perPage : pace.emaMs * 0.7 + perPage * 0.3;
        setPaceMs(pace.emaMs);
      }
    }
    pace.lastPage = page;
    pace.lastAt = now;
  }, [rstate.pageNumber]);

  const timeLeft = useMemo(() => {
    if (paceMs == null || rstate.pageNumber == null || !rstate.pageCount) return null;
    const remaining = rstate.pageCount - rstate.pageNumber;
    if (remaining <= 0) return null;
    const mins = Math.round((remaining * paceMs) / 60000);
    return mins < 1 ? "< 1 min left" : `≈ ${mins} min left`;
  }, [paceMs, rstate.pageNumber, rstate.pageCount]);

  /* -------------------------------------------------------------- haptics */

  // Only a paginated surface has discrete "turns" to feel. In webtoon and
  // scrolled flow the page number tracks the scroll position, so ticking on it
  // would buzz continuously under the reader's thumb — the fastest way to make
  // someone switch haptics off forever.
  const hapticSurface =
    format === "comic" || format === "pdf"
      ? comicMode !== "scroll"
      : flow !== "scrolled";

  // Reopening a book must not tick, so the remembered position resets with it.
  const lastFelt = useRef<TurnState>({ page: null, chapter: null });
  useEffect(() => {
    lastFelt.current = { page: null, chapter: null };
  }, [shown.id]);

  useEffect(() => {
    const next: TurnState = {
      page: rstate.pageNumber,
      chapter: rstate.chapters.find((c) => c.active)?.key ?? null,
    };
    const previous = lastFelt.current;
    lastFelt.current = next;

    const kind = hapticForTurn(previous, next, { enabled: haptics, paged: hapticSurface });
    if (kind) api.hapticTick(kind);
  }, [rstate.pageNumber, rstate.chapters, haptics, hapticSurface]);

  /* ------------------------------------------------------------ immersive */

  // Leaving the reader always restores the OS chrome, even if the pref is on —
  // the library is not a reading surface.
  useEffect(() => {
    void applyImmersive(immersive);
    return () => {
      void applyImmersive(false);
    };
  }, [immersive]);

  /* ------------------------------------------------------------ back-stack */

  // Positions are opaque here (CFI or page index) — the sub-reader mints them
  // via getPosition() and consumes them via goTo(), so one stack serves all
  // three readers.
  const backStack = useRef<(string | number)[]>([]);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    backStack.current = [];
    setCanGoBack(false);
  }, [shown.id]);

  /* ------------------------------------------------------- deep link in */

  // A local full-text hit opens the book *at the passage*. The sub-reader
  // restores saved progress on its own schedule, so wait until it has reported
  // live content and let that restore settle before overriding it — otherwise
  // the jump lands first and the restore drags the reader back.
  const deepLinked = useRef(false);
  const ready = rstate.pageCount != null || rstate.chapters.length > 0;
  useEffect(() => {
    if (openTarget == null || deepLinked.current || !ready) return;
    deepLinked.current = true;
    const timer = window.setTimeout(() => {
      apiRef.current?.goTo(openTarget);
      clearOpenTarget();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [openTarget, ready, clearOpenTarget]);

  /** Brief pulse on the Return control so a TOC/bookmark jump is obviously
   *  reversible without hunting for the affordance. */
  const [returnPulse, setReturnPulse] = useState(false);
  const returnPulseTimer = useRef<number | null>(null);

  /** Record where we are, then run a jump. */
  const jump = useCallback((go: () => void) => {
    const pos = apiRef.current?.getPosition();
    if (pos != null) {
      const stack = backStack.current;
      // Jumping to where you already are shouldn't stack a no-op return.
      if (stack[stack.length - 1] !== pos) {
        stack.push(pos);
        if (stack.length > MAX_BACK) stack.shift();
        setCanGoBack(true);
        setReturnPulse(true);
        if (returnPulseTimer.current != null) {
          window.clearTimeout(returnPulseTimer.current);
        }
        returnPulseTimer.current = window.setTimeout(() => {
          setReturnPulse(false);
          returnPulseTimer.current = null;
        }, 2200);
      }
    }
    go();
  }, []);

  useEffect(() => {
    return () => {
      if (returnPulseTimer.current != null) {
        window.clearTimeout(returnPulseTimer.current);
      }
    };
  }, []);

  const goBack = useCallback(() => {
    const pos = backStack.current.pop();
    setCanGoBack(backStack.current.length > 0);
    setReturnPulse(false);
    if (pos != null) apiRef.current?.goTo(pos);
  }, []);

  const onStageClick = useCallback((e: React.MouseEvent) => {
    if (!scrollMode) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, select, textarea, [role='button'], .pdf-text-layer, .status-overlay")) {
      return;
    }
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
      return;
    }
    toggleChrome();
  }, [scrollMode, toggleChrome]);

  /* --------------------------------------------------------------- paging */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack arrows/space while the reader is typing a page number.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;

      if (
        e.key === "ArrowRight" ||
        (scrollMode && (e.key === "ArrowDown" || e.key === "PageDown"))
      ) {
        e.preventDefault();
        next();
      } else if (
        e.key === "ArrowLeft" ||
        (scrollMode && (e.key === "ArrowUp" || e.key === "PageUp"))
      ) {
        e.preventDefault();
        prev();
      } else if (e.key === " ") {
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        // Cmd/Ctrl+F while reading opens in-book search (not library search).
        e.preventDefault();
        setPanel((cur) => (cur === "search" ? null : "search"));
      } else if (e.key === "Escape") {
        setPanel(null);
        setSeekOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, scrollMode]);

  // Swipe paging (paged modes only).
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    touchStart.current = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else prev();
    }
  };

  /* -------------------------------------------------------------- seeking */

  const trackRef = useRef<HTMLDivElement | null>(null);
  const [scrubPct, setScrubPct] = useState<number | null>(null);

  const pctFromX = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
  }, []);

  const onTrackDown = (e: React.PointerEvent) => {
    if (!rstate.canSeek) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubPct(pctFromX(e.clientX));
  };
  const onTrackMove = (e: React.PointerEvent) => {
    if (scrubPct == null) return;
    setScrubPct(pctFromX(e.clientX));
  };
  // Commit on release only: seeking on every move would thrash an EPUB's
  // rendition (each display() is a re-render + a progress write).
  const onTrackUp = (e: React.PointerEvent) => {
    if (scrubPct == null) return;
    const pct = pctFromX(e.clientX);
    setScrubPct(null);
    jump(() => apiRef.current?.goToPercent(pct));
  };

  const shownPct = scrubPct ?? rstate.percent ?? 0;
  const scrubbing = scrubPct != null;
  /** Destination preview while dragging — page/spread, chapter, percent. */
  const scrubDest = useMemo(() => {
    if (scrubPct == null) return null;
    return scrubPreview({
      scrubPct,
      pageCount: rstate.pageCount,
      spread:
        (format === "comic" || format === "pdf") && comicMode === "spread",
      chapters: rstate.chapters,
      locationMode: format === "epub" && flow === "scrolled",
    });
  }, [
    scrubPct,
    rstate.pageCount,
    rstate.chapters,
    format,
    comicMode,
    flow,
  ]);

  const submitSeek = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const pageRaw = String(data.get("page") ?? "").trim();
    const pctRaw = String(data.get("percent") ?? "").trim();
    setSeekOpen(false);
    if (pageRaw && rstate.pageCount) {
      const n = clamp(parseInt(pageRaw, 10), 1, rstate.pageCount);
      if (Number.isFinite(n)) jump(() => apiRef.current?.goToPage(n));
      return;
    }
    if (pctRaw) {
      const p = clamp(parseFloat(pctRaw), 0, 100);
      if (Number.isFinite(p)) jump(() => apiRef.current?.goToPercent(p));
    }
  };

  const openPanel = (p: Exclude<Panel, null>) =>
    setPanel((cur) => (cur === p ? null : p));
  const closePanel = () => setPanel(null);

  const showSideArrows = chrome && !scrollMode;
  const showProgressRow = rstate.pageLabel != null;
  const showBottom = chrome && (rstate.bottomExtra != null || showProgressRow);

  return (
    <div className="reader">
      <div
        className="reader-stage"
        onClick={scrollMode ? onStageClick : undefined}
        onTouchStart={paged ? onTouchStart : undefined}
        onTouchEnd={paged ? onTouchEnd : undefined}
      >
        {record == null ? (
          <div className="reader-message">
            <div className="status-spinner" aria-hidden="true" />
            <span className="status-message">{LOAD_MESSAGES.loadingBook}</span>
          </div>
        ) : (
          <ErrorBoundary
            onError={onReaderCrash}
            fallback={<div className="reader-message">Returning to your library…</div>}
          >
            <Suspense
              fallback={
                <div className="reader-message">
                  <div className="status-spinner" aria-hidden="true" />
                  <span className="status-message">{LOAD_MESSAGES.loadingBook}</span>
                </div>
              }
            >
              {format === "comic" ? (
                <ComicReader
                  key={`comic-${comicMode}`}
                  ref={apiRef}
                  record={liveRecord}
                  onState={report}
                />
              ) : format === "pdf" ? (
                <PdfReader
                  key={`pdf-${comicMode}`}
                  ref={apiRef}
                  record={liveRecord}
                  onState={report}
                />
              ) : (
                // EPUB via Readium TS Toolkit (see lib/readiumZip.ts).
                <TextReader
                  key={`epub-${flow}`}
                  ref={apiRef}
                  record={liveRecord}
                  onState={report}
                  onToggleChrome={toggleChrome}
                />
              )}
            </Suspense>
          </ErrorBoundary>
        )}

        {paged && (
          <div className="tapzones">
            <div className="tap-prev" onClick={prev} />
            <div className="tap-toggle" onClick={toggleChrome} />
            <div className="tap-next" onClick={next} />
          </div>
        )}
      </div>

      {chrome && (
        <div className={`chrome-top${panel ? " over-panel" : ""}`}>
          <button className="back-btn" onClick={closeReader}>
            ‹ Library
          </button>
          <div className="center-title">
            <div className="center-title-main">{shown.title}</div>
            <div className="center-title-sub">
              {metaLine(shown)}
              <span className="center-title-sep" aria-hidden="true">
                ·
              </span>
              <span className="center-title-source">{sourceChromeLabel(shown)}</span>
            </div>
          </div>
          <div className="nav-cluster">
            {canGoBack && (
              <button
                className={`nav-btn return-btn${returnPulse ? " pulse" : ""}`}
                onClick={goBack}
                aria-label="Return to previous location"
                title="Return to previous location"
              >
                <span aria-hidden="true">↩</span>
                <span className="return-btn-label">Return</span>
              </button>
            )}
            <button
              className={`nav-btn${panel === "search" ? " active" : ""}`}
              onClick={() => openPanel("search")}
              aria-label="Search this book"
              title="Search this book (Cmd/Ctrl+F)"
            >
              🔍
            </button>
            <button
              className={`nav-btn${panel === "toc" ? " active" : ""}`}
              onClick={() => openPanel("toc")}
              aria-label="Table of contents"
            >
              ☰
            </button>
            <button
              className={`nav-btn${rstate.isBookmarked ? " active" : ""}`}
              onClick={() => apiRef.current?.toggleBookmark()}
              aria-label="Toggle bookmark"
            >
              <RibbonIcon size={15} />
            </button>
            <button
              className={`nav-btn serif${panel === "settings" ? " active" : ""}`}
              onClick={() => openPanel("settings")}
              aria-label="Reading settings"
            >
              Aa
            </button>
          </div>
        </div>
      )}

      {showSideArrows && (
        <>
          <button className="side-arrow left" onClick={prev} aria-label="Previous">
            ‹
          </button>
          <button className="side-arrow right" onClick={next} aria-label="Next">
            ›
          </button>
        </>
      )}

      {showBottom && (
        <div className="chrome-bottom">
          {rstate.bottomExtra}
          {showProgressRow && (
            <div className={`progress-row${scrubbing ? " is-scrubbing" : ""}`}>
              <button
                className={`page-label${scrubbing ? " scrubbing" : ""}`}
                onClick={() => rstate.canSeek && setSeekOpen((v) => !v)}
                disabled={!rstate.canSeek}
                aria-label="Go to page"
              >
                {/* Keep the label visible while dragging — show destination. */}
                {scrubDest?.label ?? rstate.pageLabel}
              </button>
              <div
                ref={trackRef}
                className={`progress-track${rstate.canSeek ? " seekable" : ""}${
                  scrubbing ? " scrubbing" : ""
                }`}
                onPointerDown={onTrackDown}
                onPointerMove={onTrackMove}
                onPointerUp={onTrackUp}
                onPointerCancel={() => setScrubPct(null)}
                role="slider"
                aria-label="Reading position"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(shownPct)}
                aria-valuetext={
                  scrubDest
                    ? scrubDest.chapter
                      ? `${scrubDest.label}, ${scrubDest.chapter}`
                      : scrubDest.label
                    : rstate.pageLabel ?? undefined
                }
                tabIndex={rstate.canSeek ? 0 : -1}
              >
                <div style={{ width: `${shownPct}%` }} />
                {rstate.canSeek && (
                  <span className="progress-thumb" style={{ left: `${shownPct}%` }} />
                )}
                {scrubDest && (
                  <span className="scrub-bubble" style={{ left: `${shownPct}%` }}>
                    <span className="scrub-bubble-main">{scrubDest.label}</span>
                    {scrubDest.chapter && (
                      <span className="scrub-bubble-chapter">{scrubDest.chapter}</span>
                    )}
                    <span className="scrub-bubble-pct">{scrubDest.percent}%</span>
                  </span>
                )}
              </div>
              <div className={`progress-pct${scrubbing ? " scrubbing" : ""}`}>
                {rstate.percent != null || scrubbing
                  ? `${Math.round(shownPct)}%`
                  : ""}
              </div>
              {timeLeft && !scrubbing && (
                <div className="time-left">{timeLeft}</div>
              )}
            </div>
          )}

          {seekOpen && (
            <form className="seek-pop" onSubmit={submitSeek}>
              <label className="seek-field">
                <span>Page</span>
                <input
                  name="page"
                  type="number"
                  min={1}
                  max={rstate.pageCount ?? undefined}
                  placeholder={rstate.pageNumber ? String(rstate.pageNumber) : "1"}
                  autoFocus
                />
                <span className="seek-of">of {rstate.pageCount ?? "?"}</span>
              </label>
              <label className="seek-field">
                <span>Percent</span>
                <input
                  name="percent"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  placeholder={rstate.percent != null ? String(rstate.percent) : "0"}
                />
                <span className="seek-of">%</span>
              </label>
              <button type="submit" className="seek-go">
                Go
              </button>
            </form>
          )}
        </div>
      )}

      {finished && record && (
        <FinishedOverlay
          record={record}
          guest={guest}
          onDismiss={() => setFinished(false)}
          onBackToLibrary={closeReader}
        />
      )}

      {panel && (
        <>
          <div className="backdrop" onClick={closePanel} />
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            {panel === "search" ? (
              <SearchDrawer
                bookTitle={shown.title}
                search={(q) => apiRef.current?.search?.(q) ?? Promise.resolve([])}
                onGo={(target) => {
                  jump(() => {
                    const t = String(target);
                    // EPUB hits target a section href; PDF hits a page index.
                    if (/^\d+$/.test(t) && format !== "epub") {
                      apiRef.current?.goTo(Number(t));
                    } else {
                      apiRef.current?.goToChapter(t);
                    }
                  });
                  closePanel();
                }}
                onClose={closePanel}
              />
            ) : panel === "settings" ? (
              <SettingsDrawer format={format} bookId={shown.id} onClose={closePanel} />
            ) : (
              <TocDrawer
                bookTitle={shown.title}
                hasContents={rstate.hasContents}
                chapters={rstate.chapters}
                bookmarks={rstate.bookmarks}
                highlights={rstate.highlights}
                tab={rstate.hasContents ? tocTab : "bookmarks"}
                onTabChange={setTocTab}
                onGoChapter={(target) => {
                  jump(() => apiRef.current?.goToChapter(target));
                  closePanel();
                }}
                onGoBookmark={(item) => {
                  jump(() => apiRef.current?.goToBookmark(item));
                  closePanel();
                }}
                onGoHighlight={(item) => {
                  jump(() => apiRef.current?.goToHighlight?.(item));
                  closePanel();
                }}
                onRemoveHighlight={(key) => apiRef.current?.removeHighlight?.(key)}
                onEditBookmarkNote={(item, note) =>
                  apiRef.current?.setBookmarkNote?.(item, note)
                }
                onEditHighlightNote={(item, note) =>
                  apiRef.current?.setHighlightNote?.(item, note)
                }
                onClose={closePanel}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
