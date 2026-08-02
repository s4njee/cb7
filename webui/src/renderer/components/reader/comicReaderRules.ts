import type { ReaderPrefs } from '@/store/readerStore';

/**
 * @file comicReaderRules.ts
 * Comic Reader Behaviour Rules
 *
 * 
 * Architecture overview for Junior Devs:
 * The comic reader has a few fiddly behaviours: cycling zoom modes, single vs.
 * double-page ("spread") layout, clamping page numbers to valid bounds, and
 * pre-loading neighbouring pages for smooth navigation. These are extracted as
 * pure functions so the rules can be unit tested without rendering the reader.
 */

/** Available zoom modes for the comic reader. */
export type ComicZoomMode = ReaderPrefs['zoomMode'];
/** Single- vs double-page layout. */
export type ComicSpreadMode = ReaderPrefs['spread'];
/** Reading direction controls how physical left/right input is mirrored. */
export type ComicDirection = ReaderPrefs['direction'];
/** A physical side or arrow key, independent of reading direction. */
export type ComicPhysicalTurn = 'left' | 'right';
/** A logical move through the book, independent of physical input direction. */
export type ComicLogicalTurn = 'forward' | 'backward';
/** CSS animation class for page slide transitions. */
export type ComicSlideClass = 'slide-from-left' | 'slide-from-right';

/** Zoom modes in the order they cycle through. */
export const COMIC_ZOOM_MODES: ComicZoomMode[] = ['fit-height', 'fit-width', 'original'];

/**
 * Get the next zoom mode when the user cycles zoom.
 * @param current The current zoom mode.
 * @returns The next mode, wrapping around to the start of the list.
 */
export function nextComicZoomMode(current: ComicZoomMode): ComicZoomMode {
  const index = COMIC_ZOOM_MODES.indexOf(current);
  return COMIC_ZOOM_MODES[(index + 1) % COMIC_ZOOM_MODES.length];
}

/**
 * How many pages a single navigation step advances.
 * @param spread The current spread mode.
 * @returns 2 for double-page spreads, otherwise 1.
 */
export function pageStepForSpread(spread: ComicSpreadMode): number {
  return spread === 'double' ? 2 : 1;
}

/**
 * Clamp a page number into the valid 1..pageCount range.
 * @param page The requested page number.
 * @param pageCount The total number of pages.
 * @returns The page number constrained to valid bounds.
 */
export function clampReaderPage(page: number, pageCount: number): number {
  return Math.max(1, Math.min(pageCount, page));
}

/**
 * Map physical controls to logical page movement.
 *  In LTR, right-side input advances. In RTL, left-side input advances.
 *          The returned logical movement still means increasing/decreasing the
 *          page number through the book.
 * @param direction The current reading direction.
 * @param physicalTurn The physical side/key/gesture direction.
 * @returns Whether that input means forward or backward through the book.
 */
export function logicalTurnForPhysicalInput(
  direction: ComicDirection,
  physicalTurn: ComicPhysicalTurn,
): ComicLogicalTurn {
  const rightMeansForward = direction !== 'rtl';
  if (physicalTurn === 'right') return rightMeansForward ? 'forward' : 'backward';
  return rightMeansForward ? 'backward' : 'forward';
}

/**
 * Pick the slide animation class for a page change.
 * @param previousPage The prior 1-based page number.
 * @param currentPage The new 1-based page number.
 * @returns The class to add, or `null` when the page did not change.
 */
export function slideClassForPageTurn(previousPage: number, currentPage: number): ComicSlideClass | null {
  if (previousPage === currentPage) return null;
  return currentPage > previousPage ? 'slide-from-right' : 'slide-from-left';
}

/**
 * Compute preference updates for toggling the spread mode.
 *  Switches single<->double. When turning double-page on, also forces
 *          `fit-height` zoom (double spreads only look right fitted to height).
 * @param prefs The current reader preferences.
 * @returns A partial prefs object with the changes to apply.
 */
export function nextComicSpreadPrefs(prefs: ReaderPrefs): Partial<ReaderPrefs> {
  const spread: ComicSpreadMode = prefs.spread === 'double' ? 'single' : 'double';
  const updates: Partial<ReaderPrefs> = { spread };
  if (spread === 'double' && prefs.zoomMode !== 'fit-height') {
    updates.zoomMode = 'fit-height';
  }
  return updates;
}

/**
 * Whether a double-page spread should show a second page beside this one.
 * @param spread The current spread mode.
 * @param pageIndex The 0-based index of the left/first page.
 * @param pageCount The total number of pages.
 * @returns `true` when in double mode and a following page exists.
 */
export function hasSecondSpreadPage(spread: ComicSpreadMode, pageIndex: number, pageCount: number): boolean {
  return spread === 'double' && pageIndex + 1 < pageCount;
}

/**
 * Build the "current page" hint label (e.g. "3\u20134 / 120" or "3 / 120").
 * @param spread The current spread mode.
 * @param currentPage The 1-based current page number.
 * @param pageCount The total number of pages.
 * @returns A formatted page-position label.
 */
export function comicPageHintLabel(spread: ComicSpreadMode, currentPage: number, pageCount: number): string {
  const pageIndex = currentPage - 1;
  return hasSecondSpreadPage(spread, pageIndex, pageCount)
    ? `${currentPage}\u2013${currentPage + 1} / ${pageCount}`
    : `${currentPage} / ${pageCount}`;
}

/**
 * Compute which neighbouring page indexes to pre-load for smooth paging.
 *  Looks ahead and behind by the spread's step size, skipping indexes
 *          outside the valid page range.
 * @param pageIndex The 0-based index of the current page.
 * @param pageCount The total number of pages.
 * @param spread The current spread mode.
 * @returns The neighbour page indexes worth preloading.
 */
export function preloadNeighborPageIndexes(pageIndex: number, pageCount: number, spread: ComicSpreadMode): number[] {
  const indexes: number[] = [];
  const ahead = pageStepForSpread(spread);
  for (let i = 1; i <= ahead; i++) {
    if (pageIndex + i < pageCount) indexes.push(pageIndex + i);
    if (pageIndex - i >= 0) indexes.push(pageIndex - i);
  }
  return indexes;
}
