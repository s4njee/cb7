/**
 * Continuous scroll across EPUB spine items.
 *
 * Readium's ScrollSnapper never emits `no_more` / `no_less` on overscroll —
 * `go_next` / `go_prev` always ack false — so chapter changes only happen on
 * edge taps. This bridge watches wheel/touch on the active content frame and
 * calls goForward/goBackward when the user scrolls past the top or bottom of
 * the current resource.
 */

export interface ScrollChapterBridgeHandlers {
  /** True while the reader is in vertical scroll flow (not paginated/fixed). */
  isScrollMode: () => boolean;
  goNext: () => void;
  goPrev: () => void;
}

/** Pixels of intentional overscroll before changing chapter. */
const OVERSCROLL_THRESHOLD_PX = 56;
/** Treat within this many px of an edge as "at boundary". */
const EDGE_PX = 4;
/** Ignore further navigations briefly after one fires (resource swap lag). */
const COOLDOWN_MS = 700;

function atTop(wnd: Window): boolean {
  const se = wnd.document.scrollingElement;
  if (!se) return true;
  return se.scrollTop <= EDGE_PX;
}

function atBottom(wnd: Window): boolean {
  const se = wnd.document.scrollingElement;
  if (!se) return true;
  // ceil: some WebViews never quite reach scrollHeight - clientHeight.
  return Math.ceil(se.scrollTop + wnd.innerHeight) >= se.scrollHeight - EDGE_PX;
}

/**
 * Attach overscroll → chapter navigation on a Readium content window.
 * Returns a disposer; call again (after dispose) when the active frame changes.
 */
export function installScrollChapterBridge(
  wnd: Window,
  handlers: ScrollChapterBridgeHandlers,
): () => void {
  let accum = 0;
  let lastTouchY: number | null = null;
  let cooldownUntil = 0;
  let navigating = false;

  const resetAccum = () => {
    accum = 0;
  };

  const tryNavigate = (dir: 1 | -1) => {
    if (!handlers.isScrollMode()) return;
    if (navigating || Date.now() < cooldownUntil) return;
    navigating = true;
    cooldownUntil = Date.now() + COOLDOWN_MS;
    resetAccum();
    if (dir > 0) handlers.goNext();
    else handlers.goPrev();
    // Allow another attempt after the new resource has had time to mount.
    wnd.setTimeout(() => {
      navigating = false;
    }, COOLDOWN_MS);
  };

  const onWheel = (e: WheelEvent) => {
    if (!handlers.isScrollMode()) return;
    // Prefer vertical; ignore pure horizontal trackpad pans.
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;

    if (e.deltaY > 0 && atBottom(wnd)) {
      accum += e.deltaY;
      if (accum >= OVERSCROLL_THRESHOLD_PX) tryNavigate(1);
    } else if (e.deltaY < 0 && atTop(wnd)) {
      accum += -e.deltaY;
      if (accum >= OVERSCROLL_THRESHOLD_PX) tryNavigate(-1);
    } else {
      resetAccum();
    }
  };

  const onTouchStart = (e: TouchEvent) => {
    lastTouchY = e.touches[0]?.clientY ?? null;
    resetAccum();
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!handlers.isScrollMode() || lastTouchY == null) return;
    const y = e.touches[0]?.clientY;
    if (y == null) return;
    // Finger moves up → content scrolls down → positive reading direction.
    const dy = lastTouchY - y;
    lastTouchY = y;

    if (dy > 0 && atBottom(wnd)) {
      accum += dy;
      if (accum >= OVERSCROLL_THRESHOLD_PX) tryNavigate(1);
    } else if (dy < 0 && atTop(wnd)) {
      accum += -dy;
      if (accum >= OVERSCROLL_THRESHOLD_PX) tryNavigate(-1);
    } else if ((dy > 0 && !atBottom(wnd)) || (dy < 0 && !atTop(wnd))) {
      resetAccum();
    }
  };

  const onTouchEnd = () => {
    lastTouchY = null;
    // Keep accum briefly so a fling that ends at the edge still counts;
    // clear on next start / successful navigate.
  };

  wnd.addEventListener("wheel", onWheel, { passive: true });
  wnd.addEventListener("touchstart", onTouchStart, { passive: true });
  wnd.addEventListener("touchmove", onTouchMove, { passive: true });
  wnd.addEventListener("touchend", onTouchEnd, { passive: true });
  wnd.addEventListener("touchcancel", onTouchEnd, { passive: true });

  return () => {
    wnd.removeEventListener("wheel", onWheel);
    wnd.removeEventListener("touchstart", onTouchStart);
    wnd.removeEventListener("touchmove", onTouchMove);
    wnd.removeEventListener("touchend", onTouchEnd);
    wnd.removeEventListener("touchcancel", onTouchEnd);
  };
}
