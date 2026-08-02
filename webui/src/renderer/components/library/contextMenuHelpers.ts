/**
 * @module
 * Pure Helpers for the Comic Context Menu
 *
 * Architecture overview for Junior Devs:
 * Right-clicking a comic opens a context menu that can act on either the single
 * comic you clicked or, if you clicked inside a multi-selection, the whole
 * selection. The menu component owns the messy parts — React Query mutations and
 * dialog state — while this module holds the small pure rules behind it: which
 * ids an action should target, how to parse a comma-separated tag string, the
 * "N items" label, and looking a name up by id. Keeping them pure makes the
 * tricky selection logic easy to unit test.
 */

/**
 * Resolve which comic ids a context-menu action should apply to.
 * If the right-clicked comic is part of the current selection, act on
 *          the whole selection; otherwise act on just that one comic.
 * @param targetComicId The right-clicked comic's id, or null/undefined if none.
 * @param selectedIds The currently selected comic ids.
 * @returns The ids to act on (empty when there is no target).
 */
export function getContextMenuActiveIds(
  targetComicId: number | null | undefined,
  selectedIds: number[],
): number[] {
  if (targetComicId === null || targetComicId === undefined) {
    return [];
  }

  if (selectedIds.includes(targetComicId)) {
    return [...selectedIds];
  }

  return [targetComicId];
}

/**
 * Parse a comma-separated tag string into clean tag names.
 * Splits on commas, trims each entry, and drops blanks.
 * @param tagText The raw text the user typed.
 * @returns The cleaned, non-empty tag names.
 */
export function parseTagText(tagText: string): string[] {
  return tagText
    .split(',')
    .map((tagName) => tagName.trim())
    .filter(Boolean);
}

/**
 * Build a pluralized "N item(s)" label.
 * @param count The number of items.
 * @returns e.g. "1 item" or "3 items".
 */
export function formatItemCount(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`;
}

/**
 * Look up an item's name by id, with a fallback.
 * @typeParam T An item type with numeric `id` and string `name`.
 * @param items The items to search.
 * @param id The id to find.
 * @param fallbackName The name to return when no item matches.
 * @returns The matching item's name, or `fallbackName`.
 */
export function findNameById<T extends { id: number; name: string }>(
  items: T[],
  id: number,
  fallbackName: string,
): string {
  return items.find((item) => item.id === id)?.name || fallbackName;
}
