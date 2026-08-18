/**
 * @file epubReaderInteractions.ts
 * EPUB Reader Input-Gesture Rules
 *
 * 
 * Architecture overview for Junior Devs:
 * The EPUB reader is driven by keyboard keys, swipes, and taps. Deciding what a
 * given input *means* (go next? go back? open the toolbar? ignore it?) is pure
 * logic that doesn't need the DOM, so it lives here as small testable functions.
 * The React component just wires real events into these and acts on the result.
 *
 * A recurring theme is "don't hijack real interactions": typing in a form field
 * or tapping a link/button should not be treated as page navigation.
 */

/** A page-navigation intent. */
export type EpubNavAction = 'next' | 'prev';
/** A tap intent: navigation, or revealing the toolbar. */
export type EpubTapAction = EpubNavAction | 'toolbar';
/** A keyboard intent: navigation, or a chrome command (exit / fullscreen). */
export type EpubKeyboardAction = EpubNavAction | 'back' | 'fullscreen';

/** CSS selector for elements that should consume taps themselves (links, buttons, inputs). */
export const EPUB_INTERACTIVE_TAP_SELECTOR = 'a[href], button, [role="button"], input, select';

/**
 * Map a keyboard key to a navigation or chrome action.
 *  Returns `null` while the user is typing in a form field so shortcuts
 *          don't fire. Right/Space go forward; Left/Backspace go back; Escape
 *          exits the reader; `f` toggles fullscreen — matching the comic and
 *          PDF readers.
 * @param key The pressed key (`KeyboardEvent.key`).
 * @param targetTagName The tag name of the event target, if known.
 * @returns The action, or `null` if the key should be ignored.
 */
export function epubKeyboardAction(key: string, targetTagName?: string): EpubKeyboardAction | null {
  if (targetTagName === 'INPUT' || targetTagName === 'TEXTAREA' || targetTagName === 'SELECT') {
    return null;
  }
  if (key === 'ArrowRight' || key === ' ') return 'next';
  if (key === 'ArrowLeft' || key === 'Backspace') return 'prev';
  if (key === 'Escape') return 'back';
  if (key === 'f' || key === 'F') return 'fullscreen';
  return null;
}

/**
 * Map a swipe gesture to a navigation action.
 *  Requires a mostly-horizontal swipe longer than 50px; vertical or
 *          short movements are ignored (treated as scrolling). A leftward swipe
 *          goes to the next page.
 * @param dx Horizontal distance travelled (negative = leftward).
 * @param dy Vertical distance travelled.
 * @returns The navigation action, or `null` if the swipe doesn't qualify.
 */
export function epubSwipeAction(dx: number, dy: number): EpubNavAction | null {
  if (Math.abs(dx) <= 50 || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'prev';
}

/**
 * Map a tap to a navigation/toolbar action based on where it landed.
 *  Only treats near-stationary taps on non-interactive targets as taps
 *          (movement >= 10px or hitting a link/button is ignored). The viewport
 *          is split into thirds: left third = prev, right third = next, middle =
 *          toggle toolbar.
 * @param dx Horizontal movement during the tap.
 * @param dy Vertical movement during the tap.
 * @param clientX The tap's x-coordinate.
 * @param viewportWidth The reader viewport width.
 * @param isInteractiveTarget Whether the tap hit an interactive element.
 * @returns The tap action, or `null` if the tap should be ignored.
 */
export function epubTapAction(
  dx: number,
  dy: number,
  clientX: number,
  viewportWidth: number,
  isInteractiveTarget: boolean,
): EpubTapAction | null {
  if (Math.abs(dx) >= 10 || Math.abs(dy) >= 10 || isInteractiveTarget) return null;

  const zone = viewportWidth / 3;
  if (clientX < zone) return 'prev';
  if (clientX > zone * 2) return 'next';
  return 'toolbar';
}
