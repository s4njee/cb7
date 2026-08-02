/**
 * @module
 * Pure Filter and Sort Logic for the Library
 *
 * Architecture overview for Junior Devs:
 * The library can be filtered (by read status, file type, tag, search text) and
 * sorted. This module holds that logic as pure functions — no database, no React,
 * no side effects — so it can run both in the browser (live filtering of a loaded
 * list) and in tests. The server applies the same concepts in SQL; keeping the
 * rules here documented keeps both sides consistent.
 */
import type { MediaRecord, QueryOptions, FilterPreset } from '../shared/types';

type ReadStatus = 'unread' | 'in-progress' | 'completed';

/**
 * Decide whether a comic is unread, in-progress, or completed.
 *
 * Rules: no progress and never opened -> "unread"; on the last page ->
 * "completed"; anything in between -> "in-progress".
 *
 * @param comic The fields needed to judge progress.
 * @returns The read-status bucket the comic falls into.
 */
export function classifyReadStatus(comic: {
  lastPage: number | null;
  lastRead: string | null;
  pageCount: number;
}): ReadStatus {
  if (comic.lastPage === null && comic.lastRead === null) {
    return 'unread';
  }
  if (comic.lastPage === comic.pageCount - 1) {
    return 'completed';
  }
  return 'in-progress';
}

/**
 * Keep only comics matching a read status.
 * @param comics The list to filter.
 * @param status The status to keep, or `undefined` to keep everything.
 * @returns The filtered list (the same list when `status` is `undefined`).
 */
export function filterByReadStatus(
  comics: MediaRecord[],
  status: ReadStatus | undefined,
): MediaRecord[] {
  if (status === undefined) return comics;
  return comics.filter((c) => classifyReadStatus(c) === status);
}

/**
 * Keep only comics whose file has the given extension.
 * @param comics The list to filter.
 * @param ext Extension without the dot (e.g. "cbz"), or `undefined` for all.
 * @returns The filtered list (case-insensitive match on the file path).
 */
export function filterByFileExt(
  comics: MediaRecord[],
  ext: string | undefined,
): MediaRecord[] {
  if (ext === undefined) return comics;
  const suffix = '.' + ext.toLowerCase();
  return comics.filter((c) => c.filePath.toLowerCase().endsWith(suffix));
}

/**
 * Apply every active filter together (logical AND).
 *
 * A comic is kept only if it passes all of the filters that are set.
 * Unset (`undefined`) filters are skipped. Search matches the title
 * case-insensitively as a substring.
 *
 * @param comics The full list to narrow down.
 * @param filters The active filters; any field may be omitted.
 * @returns A new list containing only the comics that pass all filters.
 */
export function applyFilters(
  comics: MediaRecord[],
  filters: {
    readStatus?: ReadStatus;
    fileExt?: string;
    tag?: string;
    search?: string;
  },
): MediaRecord[] {
  let result = comics;

  if (filters.readStatus !== undefined) {
    result = filterByReadStatus(result, filters.readStatus);
  }

  if (filters.fileExt !== undefined) {
    result = filterByFileExt(result, filters.fileExt);
  }

  if (filters.tag !== undefined) {
    const tag = filters.tag;
    result = result.filter((c) => c.tags.includes(tag));
  }

  if (filters.search !== undefined && filters.search !== '') {
    const term = filters.search.toLowerCase();
    result = result.filter((c) => c.title.toLowerCase().includes(term));
  }

  return result;
}

/**
 * Pick a sensible default sort direction for a sort field.
 *
 * Date-like fields default to newest-first ("desc"); everything else
 * defaults to "asc" (e.g. A->Z by title).
 *
 * @param sortBy The field being sorted on.
 * @returns The default direction for that field.
 */
export function getDefaultSortOrder(
  sortBy: QueryOptions['sortBy'],
): 'asc' | 'desc' {
  if (sortBy === 'dateAdded' || sortBy === 'lastRead') {
    return 'desc';
  }
  return 'asc';
}

/**
 * Flip a sort direction between ascending and descending.
 * @param current The current direction.
 * @returns The opposite direction.
 */
export function toggleSortOrder(current: 'asc' | 'desc'): 'asc' | 'desc' {
  return current === 'asc' ? 'desc' : 'asc';
}

/**
 * Immutably update one field of a filter preset.
 * @param preset The existing preset (not mutated).
 * @param field The field to change.
 * @param value The new value for that field.
 * @returns A new preset with the single field replaced.
 */
export function updateFilterPreset(
  preset: FilterPreset,
  field: keyof FilterPreset,
  value: FilterPreset[keyof FilterPreset],
): FilterPreset {
  return { ...preset, [field]: value };
}

const VALID_SORT_BY: ReadonlySet<string> = new Set([
  'title',
  'dateAdded',
  'fileSize',
  'pageCount',
  'lastRead',
]);

const VALID_SORT_ORDER: ReadonlySet<string> = new Set(['asc', 'desc']);

const DEFAULT_PRESET: FilterPreset = { sortBy: 'title', sortOrder: 'asc' };

/**
 * Safely parse a stored filter preset from JSON.
 *
 * Presets are persisted to `localStorage` as JSON, so the input is
 * untrusted. Anything malformed, missing, or with invalid field values falls
 * back to the default preset rather than throwing.
 *
 * @param json The stored JSON string, or `null` when nothing is saved.
 * @returns A valid `FilterPreset` — never throws.
 */
export function parseFilterPreset(json: string | null): FilterPreset {
  if (json === null) return { ...DEFAULT_PRESET };
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_PRESET };
    }
    if (!VALID_SORT_BY.has(parsed.sortBy) || !VALID_SORT_ORDER.has(parsed.sortOrder)) {
      return { ...DEFAULT_PRESET };
    }
    const result: FilterPreset = {
      sortBy: parsed.sortBy,
      sortOrder: parsed.sortOrder,
    };
    if (parsed.readStatus === 'unread' || parsed.readStatus === 'in-progress' || parsed.readStatus === 'completed') {
      result.readStatus = parsed.readStatus;
    }
    if (typeof parsed.fileExt === 'string') {
      result.fileExt = parsed.fileExt;
    }
    if (typeof parsed.tag === 'string') {
      result.tag = parsed.tag;
    }
    return result;
  } catch {
    return { ...DEFAULT_PRESET };
  }
}
