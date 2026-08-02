import { useState, useEffect, RefObject } from 'react';

const PULL_THRESHOLD = 70;
const MAX_PULL = 120;

export type PullState = 'idle' | 'ready' | 'refreshing';

export function usePullToRefresh(
  scrollRef: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<void> | void
) {
  const [pullOffset, setPullOffset] = useState(0);
  const [pullState, setPullState] = useState<PullState>('idle');

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    let ptrStartY = 0;
    let ptrDelta = 0;
    let pulling = false;

    const handleTouchStart = (e: TouchEvent) => {
      // Pull to refresh only at the absolute top of the container
      if (scrollEl.scrollTop === 0 && e.touches.length === 1) {
        ptrStartY = e.touches[0].clientY;
        pulling = true;
        ptrDelta = 0;
        setPullState('idle');
      } else {
        pulling = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!pulling) return;
      ptrDelta = Math.min(MAX_PULL, e.touches[0].clientY - ptrStartY);
      if (ptrDelta > 0) {
        // Suppress the native iOS rubber-band bounce while we're driving the
        // PTR indicator ourselves. Requires non-passive listener registration.
        e.preventDefault();
        setPullOffset(ptrDelta);
        setPullState(ptrDelta >= PULL_THRESHOLD ? 'ready' : 'idle');
      } else {
        setPullOffset(0);
        setPullState('idle');
      }
    };

    const handleTouchEnd = async () => {
      if (!pulling) return;
      pulling = false;

      if (ptrDelta >= PULL_THRESHOLD) {
        setPullState('refreshing');
        setPullOffset(70); // Keep it visible during refresh
        try {
          await onRefresh();
        } catch (err) {
          console.error('Refresh failed:', err);
        }
        // Animate out
        setTimeout(() => {
          setPullState('idle');
          setPullOffset(0);
        }, 600);
      } else {
        setPullState('idle');
        setPullOffset(0);
      }
      ptrDelta = 0;
    };

    scrollEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    // Non-passive so we can call preventDefault() to suppress iOS native bounce
    // while the pull-to-refresh indicator is being driven by this handler.
    scrollEl.addEventListener('touchmove', handleTouchMove, { passive: false });
    scrollEl.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      scrollEl.removeEventListener('touchstart', handleTouchStart);
      scrollEl.removeEventListener('touchmove', handleTouchMove);
      scrollEl.removeEventListener('touchend', handleTouchEnd);
    };
  }, [scrollRef, onRefresh]);

  return { pullOffset, pullState };
}
