import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * @module
 * Immersive Reader Chrome Hook
 *
 * Architecture overview for Junior Devs:
 * All three readers (comic, EPUB, PDF) share one "immersive" chrome pattern:
 * the toolbar is hidden when a book opens, a center tap/click toggles it, any
 * activity (mouse movement, chrome interaction) keeps it open, and it hides
 * itself again after a few seconds of inactivity — unless the pointer is
 * resting on the chrome itself.
 *
 * The decision of "what happens next" is a pure function (`nextChromeState`)
 * so the timing rules can be unit tested without React or real timers; the
 * hook just wires that function to state, a hide timer, and hover pinning.
 */

/** How long the chrome stays up after the last activity before auto-hiding. */
export const CHROME_AUTO_HIDE_MS = 3000;

/** A user/system intent that can change chrome visibility. */
export type ChromeIntent = 'toggle' | 'reveal' | 'autoHide';

/** The outcome of an intent: the new visibility, and whether to (re)arm the hide timer. */
export interface ChromeState {
  visible: boolean;
  scheduleHide: boolean;
}

/**
 * Decide the next chrome visibility for an intent.
 *  `toggle` flips visibility; `reveal` shows it; `autoHide` hides it.
 *          A hide is only scheduled while the chrome is visible and not
 *          pinned, and a pinned chrome (pointer resting on it) never
 *          auto-hides.
 * @param visible Whether the chrome is currently visible.
 * @param pinned Whether the pointer is currently over the chrome.
 * @param intent The intent to apply.
 * @returns The next visibility and whether an auto-hide should be scheduled.
 */
export function nextChromeState(visible: boolean, pinned: boolean, intent: ChromeIntent): ChromeState {
  if (intent === 'toggle') {
    const next = !visible;
    return { visible: next, scheduleHide: next && !pinned };
  }
  if (intent === 'reveal') {
    return { visible: true, scheduleHide: !pinned };
  }
  // autoHide — defensive: never hide out from under a pointer resting on the chrome.
  return pinned ? { visible, scheduleHide: false } : { visible: false, scheduleHide: false };
}

/**
 * Own the shared show/hide/auto-hide behaviour of the reader chrome.
 * @param hideDelayMs How long after the last activity the chrome auto-hides.
 * @returns The current visibility plus the handlers to wire into the reader:
 *          `toggle` (center tap), `reveal` (any activity), and
 *          `onChromeEnter`/`onChromeLeave` (pointer pinning on the chrome).
 */
export default function useImmersiveChrome(hideDelayMs: number = CHROME_AUTO_HIDE_MS) {
  // Immersive by default: chrome starts hidden when a book opens.
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const pinnedRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyIntent = useCallback((intent: ChromeIntent) => {
    const next = nextChromeState(visibleRef.current, pinnedRef.current, intent);
    visibleRef.current = next.visible;
    setVisible(next.visible);

    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (next.scheduleHide) {
      hideTimerRef.current = setTimeout(() => applyIntent('autoHide'), hideDelayMs);
    }
  }, [hideDelayMs]);

  const toggle = useCallback(() => applyIntent('toggle'), [applyIntent]);
  const reveal = useCallback(() => applyIntent('reveal'), [applyIntent]);

  const onChromeEnter = useCallback(() => {
    pinnedRef.current = true;
    applyIntent('reveal');
  }, [applyIntent]);

  const onChromeLeave = useCallback(() => {
    pinnedRef.current = false;
    applyIntent('reveal');
  }, [applyIntent]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  return { visible, toggle, reveal, onChromeEnter, onChromeLeave };
}
