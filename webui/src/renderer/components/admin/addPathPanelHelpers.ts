import type * as api from '@/lib/api';

/**
 * @file addPathPanelHelpers.ts
 * Add-Path Panel Presentation Helpers
 *
 * 
 * Architecture overview for Junior Devs:
 * The "Add Path" admin panel shows ingest progress and, when scanning fails,
 * a breakdown of why. This module turns raw ingest events into the human-facing
 * strings and shapes the panel renders — keeping the React component focused on
 * layout while these pure functions handle the wording and number-crunching.
 */

/**
 * Map an ingest phase to a user-facing status label.
 * @param phase The current ingest phase.
 * @returns A label such as "Discovering files..." or "Processing files...".
 */
export function ingestPhaseLabel(phase: api.IngestProgressEvent['phase']): string {
  if (phase === 'discover') return 'Discovering files...';
  return 'Processing files...';
}

/**
 * Compute an integer completion percentage for a progress bar.
 * @param processed Number of files processed so far.
 * @param discovered Total number of files discovered.
 * @returns A value between 0 and 100; 0 when nothing has been discovered yet.
 */
export function ingestProgressPercent(processed: number, discovered: number): number {
  if (discovered <= 0) return 0;
  return Math.min(100, Math.round((processed / discovered) * 100));
}

/**
 * Translate an ingest error class into a readable explanation.
 *  Each known class maps to a short diagnosis (and occasionally a hint,
 *          e.g. the WASM out-of-memory tuning tip). Unknown classes are passed
 *          through unchanged.
 * @param errorClass The machine error-class identifier.
 * @returns A human-readable description.
 */
export function ingestFailureLabel(errorClass: string): string {
  switch (errorClass) {
    case 'wasm_oom':
      return 'WASM out-of-memory (try CB8_INGEST_CONCURRENCY=4)';
    case 'archive_open':
      return 'Archive open failed (corrupt / encrypted / unsupported)';
    case 'fs_missing':
      return 'File disappeared between scan and ingest';
    case 'fs_permission':
      return 'Permission denied';
    case 'timeout':
      return 'Cover / page-count extraction timed out';
    case 'unknown':
      return 'Other / unclassified';
    default:
      return errorClass;
  }
}

/**
 * Extract the final segment (file or folder name) from a path.
 * @param filePath A path using either `/` or `\` separators.
 * @returns The last segment, or the original path if it has no separators.
 */
export function pathBasename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

/**
 * Shape a failures summary for display: counts by class plus sample rows.
 *  Sorts error classes by descending count and limits the shown samples
 *          to the first 8. Tolerates a missing/empty summary.
 * @param summary The ingest failures summary event, if any.
 * @returns An object with `byClass` (sorted [class, count] pairs) and `samples`.
 */
export function failureReportDetails(
  summary: api.IngestFailuresSummaryEvent | null | undefined,
): {
  byClass: [string, number][];
  samples: api.IngestFailuresSummaryEvent['sample'];
} {
  return {
    byClass: Object.entries(summary?.byClass || {}).sort((a, b) => b[1] - a[1]),
    samples: (summary?.sample || []).slice(0, 8),
  };
}
