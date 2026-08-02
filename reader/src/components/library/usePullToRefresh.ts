/** Dependency-free pull-to-refresh for a scroll container. On touch devices, an
 *  overscroll pull at the very top translates the content and, past a threshold,
 *  fires `onRefresh`. Returns the live pull distance + a refreshing flag so the
 *  caller can render the indicator and offset its content. No-op on non-touch. */
import { useEffect, useRef, useState } from "react";

const THRESHOLD = 70;
const MAX_PULL = 110;
const RESISTANCE = 0.5;

const isTouch = typeof window !== "undefined" && "ontouchstart" in window;

export function usePullToRefresh(
  scrollRef: React.RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown>,
) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshFn = useRef(onRefresh);
  refreshFn.current = onRefresh;

  useEffect(() => {
    if (!isTouch) return;
    const el = scrollRef.current;
    if (!el) return;

    let startY = 0;
    let tracking = false;
    let active = false; // past the point where we're intercepting the gesture
    let busy = false; // mirrors `refreshing` without re-subscribing the effect

    const onStart = (e: TouchEvent) => {
      if (busy || el.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      tracking = true;
      active = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking || busy) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (active) {
          active = false;
          setPull(0);
        }
        tracking = dy > 0 && el.scrollTop <= 0;
        return;
      }
      active = true;
      // Prevent the container from scroll-bouncing while we own the pull.
      if (e.cancelable) e.preventDefault();
      setPull(Math.min(dy * RESISTANCE, MAX_PULL));
    };

    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!active) return;
      active = false;
      setPull((cur) => {
        if (cur >= THRESHOLD) {
          busy = true;
          setRefreshing(true);
          Promise.resolve(refreshFn.current())
            .catch(() => {})
            .finally(() => {
              busy = false;
              setRefreshing(false);
              setPull(0);
            });
          return THRESHOLD;
        }
        return 0;
      });
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [scrollRef]);

  return { pull, refreshing, enabled: isTouch };
}
