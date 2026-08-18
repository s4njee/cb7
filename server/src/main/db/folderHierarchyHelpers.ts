import type { SqlParam } from './types';

/**
 * @file folderHierarchyHelpers.ts
 * Folder / Series Grouping Helpers
 *
 * 
 * Architecture overview for Junior Devs:
 * The library can be grouped by series, volume, or chapter. These groupings can
 * contain a bucket for items that have *no* value (a comic with no series name,
 * say). This module provides the small pieces that make that work:
 *  - a sentinel key (`FOLDER_GROUP_NONE_KEY`) that represents the "none" bucket,
 *  - label/key formatting for numeric groups (volumes, chapters),
 *  - parameterised SQL filters that select one group at a time.
 *
 * Like the other DB helpers, the filter functions push SQL fragments into a
 * shared `conditions` array and their values into a shared `params` array, which
 * keeps queries injection-safe.
 */

/** Sentinel group key meaning "items with no value for this grouping". */
export const FOLDER_GROUP_NONE_KEY = '__none__';

/**
 * Build a human-readable label for a numeric group (e.g. "Volume 3").
 * @param value The numeric value, or `null` for the "none" bucket.
 * @param fallback Label to use when `value` is null.
 * @param noun Leading noun, e.g. `"Volume"` or `"Chapter"`.
 * @returns The formatted label; integers are shown without a decimal point.
 */
export function formatNumberLabel(value: number | null, fallback: string, noun: string): string {
  if (value == null) return fallback;
  return `${noun} ${Number.isInteger(value) ? value.toFixed(0) : String(value)}`;
}

/**
 * Build the stable string key used to identify a numeric group.
 * @param value The numeric value, or `null`.
 * @returns The "none" sentinel for null, otherwise a canonical numeric string.
 */
export function numericGroupKey(value: number | null): string {
  if (value == null) return FOLDER_GROUP_NONE_KEY;
  return Number.isInteger(value) ? value.toFixed(0) : String(value);
}

/**
 * Add a SQL filter that selects a single series group.
 *  For the "none" bucket it matches rows whose series name is null or
 *          blank; otherwise it matches by name case-insensitively.
 * @param conditions Shared conditions array to append to.
 * @param params Shared bound-parameter array to append to.
 * @param seriesKey The group key (a series name, or the "none" sentinel).
 */
export function addSeriesFilter(conditions: string[], params: SqlParam[], seriesKey: string): void {
  if (seriesKey === FOLDER_GROUP_NONE_KEY) {
    conditions.push("NULLIF(TRIM(c.series_name), '') IS NULL");
  } else {
    conditions.push('lower(c.series_name) = lower(?)');
    params.push(seriesKey);
  }
}

/**
 * Add a SQL filter that selects a single volume- or chapter-number group.
 *  Handles three cases: the "none" bucket (column IS NULL), an
 *          unparseable key (forces `1 = 0` so nothing matches), and a valid
 *          number (parameterised equality).
 * @param conditions Shared conditions array to append to.
 * @param params Shared bound-parameter array to append to.
 * @param column Which numeric column to filter on.
 * @param key The group key (a number string, or the "none" sentinel).
 */
export function addNumberFilter(
  conditions: string[],
  params: SqlParam[],
  column: 'volume_number' | 'chapter_number',
  key: string,
): void {
  if (key === FOLDER_GROUP_NONE_KEY) {
    conditions.push(`c.${column} IS NULL`);
    return;
  }
  const value = Number(key);
  if (!Number.isFinite(value)) {
    conditions.push('1 = 0');
    return;
  }
  conditions.push(`c.${column} = ?`);
  params.push(value);
}
