import { useEffect } from 'react';

/**
 * @module
 * Keyboard Shortcuts Hook for the Comic Reader
 *
 * Architecture overview for Junior Devs:
 * This React hook attaches a global `keydown` listener while the comic reader is
 * mounted and maps keys to actions: arrows/space/page-up-down to navigate,
 * Home/End to jump to first/last page, Z to cycle zoom, B to bookmark, S to
 * toggle two-page spread, and +/-/0 to zoom in/out/reset. (Escape and F are
 * chrome-level shortcuts owned by ReaderPage, shared across all readers.)
 * Shortcuts never fire while an editable form control has focus.
 *
 * It is intentionally "dumb": it doesn't know what forward/back *mean* (that
 * depends on reading direction), so it just calls the callbacks the caller
 * passes in. The listener is added on mount and removed on unmount.
 */

const MAX_SCALE = 5;

/** Callbacks the reader supplies for each keyboard action. */
interface UseComicKeyboardOptions {
  /** Left arrow — spatial; mapped to forward/backward by the caller per direction. */
  onLeft: () => void;
  /** Right arrow — spatial; mapped to forward/backward by the caller per direction. */
  onRight: () => void;
  /** Space / PageDown — always advance through the book. */
  onForward: () => void;
  /** Backspace / PageUp — always go back through the book. */
  onBackward: () => void;
  onFirstPage: () => void;
  onLastPage: () => void;
  onCycleZoom: () => void;
  onToggleBookmark: () => void;
  onToggleSpread: () => void;
  panRef: React.MutableRefObject<{ scale: number; tx: number; ty: number }>;
  applyTransform: () => void;
  resetTransform: () => void;
}

/**
 * Wire up comic-reader keyboard shortcuts for the lifetime of the component.
 * @param options The action callbacks and pan/zoom refs to drive.
 */
export default function useComicKeyboard({
  onLeft,
  onRight,
  onForward,
  onBackward,
  onFirstPage,
  onLastPage,
  onCycleZoom,
  onToggleBookmark,
  onToggleSpread,
  panRef,
  applyTransform,
  resetTransform,
}: UseComicKeyboardOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't hijack typing in form fields (e.g. inputs in sheets/dialogs).
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }

      const pan = panRef.current;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          onRight();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          onLeft();
          break;
        case ' ':
        case 'PageDown':
          e.preventDefault();
          onForward();
          break;
        case 'Backspace':
        case 'PageUp':
          e.preventDefault();
          onBackward();
          break;
        case 'Home':
          e.preventDefault();
          onFirstPage();
          break;
        case 'End':
          e.preventDefault();
          onLastPage();
          break;
        case 'z':
        case 'Z':
          e.preventDefault();
          onCycleZoom();
          break;
        case 'b':
        case 'B':
          e.preventDefault();
          onToggleBookmark();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          onToggleSpread();
          break;
        case '+':
        case '=':
          e.preventDefault();
          pan.scale = Math.min(MAX_SCALE, pan.scale + 0.25);
          applyTransform();
          break;
        case '-':
        case '_':
          e.preventDefault();
          pan.scale = Math.max(1, pan.scale - 0.25);
          if (pan.scale <= 1.001) {
            resetTransform();
          } else {
            applyTransform();
          }
          break;
        case '0':
          e.preventDefault();
          resetTransform();
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    onLeft,
    onRight,
    onForward,
    onBackward,
    onFirstPage,
    onLastPage,
    onCycleZoom,
    onToggleBookmark,
    onToggleSpread,
    panRef,
    applyTransform,
    resetTransform,
  ]);
}
