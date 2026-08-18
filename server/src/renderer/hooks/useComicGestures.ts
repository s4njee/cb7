import { useEffect, useRef } from 'react';

const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const mid = (a: Touch, b: Touch) => ({
  x: (a.clientX + b.clientX) / 2,
  y: (a.clientY + b.clientY) / 2,
});

const MAX_SCALE = 5;

interface PanState {
  scale: number;
  tx: number;
  ty: number;
}

interface Point {
  x: number;
  y: number;
}

type GestureState =
  | {
      kind: 'pinch';
      d0: number;
      c0: Point;
      baseScale: number;
      baseTx: number;
      baseTy: number;
    }
  | {
      kind: 'pan';
      x: number;
      y: number;
      baseTx: number;
      baseTy: number;
    }
  | {
      kind: 'swipe';
      x: number;
      y: number;
      t0: number;
    };

interface UseComicGesturesOptions {
  readerBodyRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  panRef: React.MutableRefObject<PanState>;
  applyTransform: () => void;
  resetTransform: () => void;
  onSwipe: (dir: 1 | -1) => void;
  prefs: { spread: 'single' | 'double'; direction: 'ltr' | 'rtl' };
}

export default function useComicGestures({
  readerBodyRef,
  stageRef,
  panRef,
  applyTransform,
  resetTransform,
  onSwipe,
  prefs,
}: UseComicGesturesOptions) {
  const gestureRef = useRef<GestureState | null>(null);
  const lastTapRef = useRef({ t: 0, x: 0, y: 0 });

  useEffect(() => {
    const readerBody = readerBodyRef.current;
    if (!readerBody) return;

    const handleTouchStart = (e: TouchEvent) => {
      const pan = panRef.current;
      if (e.touches.length === 2) {
        e.preventDefault();
        gestureRef.current = {
          kind: 'pinch',
          d0: dist(e.touches[0], e.touches[1]),
          c0: mid(e.touches[0], e.touches[1]),
          baseScale: pan.scale,
          baseTx: pan.tx,
          baseTy: pan.ty,
        };
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        if (pan.scale > 1.001) {
          gestureRef.current = {
            kind: 'pan',
            x: t.clientX,
            y: t.clientY,
            baseTx: pan.tx,
            baseTy: pan.ty,
          };
        } else {
          gestureRef.current = {
            kind: 'swipe',
            x: t.clientX,
            y: t.clientY,
            t0: Date.now(),
          };
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;

      const pan = panRef.current;
      if (gesture.kind === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        const d = dist(e.touches[0], e.touches[1]);
        const c = mid(e.touches[0], e.touches[1]);
        const newScale = Math.max(1, Math.min(MAX_SCALE, gesture.baseScale * (d / gesture.d0)));
        pan.scale = newScale;
        pan.tx = gesture.baseTx + (c.x - gesture.c0.x);
        pan.ty = gesture.baseTy + (c.y - gesture.c0.y);
        if (newScale <= 1.001) {
          pan.tx = 0;
          pan.ty = 0;
        }
        applyTransform();
      } else if (gesture.kind === 'pan' && e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0];
        pan.tx = gesture.baseTx + (t.clientX - gesture.x);
        pan.ty = gesture.baseTy + (t.clientY - gesture.y);
        applyTransform();
      } else if (gesture.kind === 'swipe' && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - gesture.x;
        const dy = t.clientY - gesture.y;
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
          e.preventDefault();
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;

      const pan = panRef.current;
      if (gesture.kind === 'swipe' && e.changedTouches.length) {
        const tch = e.changedTouches[0];
        const dx = tch.clientX - gesture.x;
        const dy = tch.clientY - gesture.y;
        const duration = Date.now() - gesture.t0;

        if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && duration < 300) {
          const now = Date.now();
          const lastTap = lastTapRef.current;
          if (
            now - lastTap.t < 300 &&
            Math.hypot(tch.clientX - lastTap.x, tch.clientY - lastTap.y) < 40
          ) {
            if (pan.scale > 1.001) {
              resetTransform();
            } else {
              const rect = readerBody.getBoundingClientRect();
              pan.scale = 2;
              pan.tx = rect.width / 2 - (tch.clientX - rect.left);
              pan.ty = rect.height / 2 - (tch.clientY - rect.top);
              applyTransform();
            }
            lastTapRef.current = { t: 0, x: 0, y: 0 };
          } else {
            lastTapRef.current = { t: now, x: tch.clientX, y: tch.clientY };
          }
        } else if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && pan.scale <= 1.001) {
          const swipeDir = dx < 0 ? 1 : -1;
          onSwipe(swipeDir);
        }
      }

      if (pan.scale < 1.001) {
        resetTransform();
      }
      gestureRef.current = null;
    };

    readerBody.addEventListener('touchstart', handleTouchStart, { passive: false });
    readerBody.addEventListener('touchmove', handleTouchMove, { passive: false });
    readerBody.addEventListener('touchend', handleTouchEnd, { passive: true });
    readerBody.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      readerBody.removeEventListener('touchstart', handleTouchStart);
      readerBody.removeEventListener('touchmove', handleTouchMove);
      readerBody.removeEventListener('touchend', handleTouchEnd);
      readerBody.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [readerBodyRef, stageRef, panRef, applyTransform, resetTransform, onSwipe, prefs]);
}
