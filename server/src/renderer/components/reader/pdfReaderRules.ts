/**
 * @module
 * Pure Navigation Rules for the PDF Reader
 *
 * Architecture overview for Junior Devs:
 * The PDF reader can be driven three ways — keyboard, tap, and swipe — and it has
 * to clamp page numbers and recognise a harmless "render cancelled" error. This
 * module holds all of those decisions as pure functions, with no React or PDF.js
 * objects involved, so the reader component just maps an input event to one of
 * these calls and the rules stay trivial to unit test.
 *
 * Each input helper returns a `PdfPageAction` ('next'/'prev') or `null` when the
 * input shouldn't navigate — e.g. a keypress inside a form field, a tap in the
 * dead centre zone, or a swipe shorter than the threshold.
 */

/** A page-turn direction produced by a navigation input. */
export type PdfPageAction = 'next' | 'prev';

/** Tag names of editable form fields where key navigation must be ignored. */
const FORM_FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Clamp a page number into the valid 1..pageCount range.
 * @param page The desired page number.
 * @param pageCount The document's total page count.
 * @returns A page within range; 1 when the count is non-positive.
 */
export function clampPdfPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 1;
  return Math.max(1, Math.min(pageCount, page));
}

/**
 * Map a keypress to a page action.
 * Right arrow / space go next; left arrow / backspace go previous.
 *          Returns null when the event originated in a form field.
 * @param key The `KeyboardEvent.key` value.
 * @param targetTagName The event target's tag name, if any.
 * @returns The page action, or null if the key shouldn't navigate.
 */
export function pdfKeyboardAction(key: string, targetTagName?: string): PdfPageAction | null {
  if (targetTagName && FORM_FIELD_TAGS.has(targetTagName.toUpperCase())) {
    return null;
  }

  if (key === 'ArrowRight' || key === ' ') return 'next';
  if (key === 'ArrowLeft' || key === 'Backspace') return 'prev';
  return null;
}

/**
 * Map a tap position to a page action.
 * Splits the width into thirds: left third goes previous, right third
 *          goes next, and the middle is a dead zone (returns null).
 * @param clientX The tap's x coordinate within the container.
 * @param containerWidth The container's width in pixels.
 * @returns The page action, or null for a centre tap / zero width.
 */
export function pdfTapAction(clientX: number, containerWidth: number): PdfPageAction | null {
  if (containerWidth <= 0) return null;

  const zone = clientX / containerWidth;
  if (zone < 0.33) return 'prev';
  if (zone > 0.67) return 'next';
  return null;
}

/**
 * Map a horizontal swipe to a page action.
 * Ignores swipes at or below the threshold. A leftward swipe (negative
 *          delta) goes next; a rightward swipe goes previous.
 * @param deltaX The horizontal swipe distance (end minus start).
 * @param threshold The minimum absolute distance to count as a swipe.
 * @returns The page action, or null if the swipe was too small.
 */
export function pdfSwipeAction(deltaX: number, threshold = 50): PdfPageAction | null {
  if (Math.abs(deltaX) <= threshold) return null;
  return deltaX < 0 ? 'next' : 'prev';
}

/**
 * Whether an error is PDF.js's benign "rendering cancelled" exception.
 * These fire when a page render is superseded by a newer one and should
 *          be swallowed rather than surfaced as a real error.
 * @param err The caught error.
 * @returns `true` if it is a `RenderingCancelledException`.
 */
export function isPdfRenderCancellation(err: unknown): boolean {
  return err instanceof Error && err.name === 'RenderingCancelledException';
}
