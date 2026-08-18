/**
 * @module
 * Reader Status-Bar Page Counter Formatting
 *
 * Architecture overview for Junior Devs:
 * Internally pages are tracked from 0 (page index 0 is the first page), but
 * humans expect to see "1 / 20". This one helper does that translation so the
 * "+1" never gets forgotten or duplicated across the UI.
 */

/**
 * Format the "current / total" page indicator for the status bar.
 * @param currentPage Zero-based index of the page being viewed.
 * @param totalPages Total number of pages in the document.
 * @returns A human-friendly string like "3 / 20".
 */
export function formatStatusBar(currentPage: number, totalPages: number): string {
  return `${currentPage + 1} / ${totalPages}`;
}
