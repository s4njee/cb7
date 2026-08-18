import { formatBytes, isAccepted } from '../../lib/dropUtils';

/**
 * @module
 * Upload Queue State & Display Helpers
 *
 * Architecture overview for Junior Devs:
 * The upload panel maintains a queue of files the user has dropped in, each with
 * its own status and progress. This module holds the pure logic behind that queue:
 * adding new files (filtering out unsupported types and duplicates), totalling
 * sizes, deciding the action-button label, and turning each item's status into the
 * text/colour/percentage the row should show. Keeping it separate lets the React
 * component stay declarative and lets these rules be unit tested without the DOM.
 */

/** Lifecycle status of a single queued upload. */
export type UploadQueueStatus = 'pending' | 'uploading' | 'done' | 'skipped' | 'error';

/** A file in the upload queue, with its progress and status. */
export interface UploadQueueItem {
  file: Pick<File, 'size'>;
  relPath: string;
  status: UploadQueueStatus;
  loaded: number;
  error?: string;
}

/** A candidate file the user dropped in, before it enters the queue. */
export type UploadCandidate = {
  file: File;
  relPath: string;
};

/** The display state for one upload row: label, CSS class, and percent. */
export type UploadRowStatus = {
  text: string;
  className: string;
  percent: number;
};

/**
 * Append accepted, non-duplicate candidates to the upload queue.
 * Skips unsupported file types (`isAccepted`) and any candidate whose
 *          `relPath` is already queued. New items start as `pending` with no
 *          bytes loaded. Returns a new array; the input queue is not mutated.
 * @typeParam T The concrete queue-item type.
 * @param queue The existing upload queue.
 * @param items The candidate files to add.
 * @returns A new queue with the accepted candidates appended.
 */
export function appendAcceptedUploadItems<T extends UploadQueueItem>(
  queue: T[],
  items: UploadCandidate[],
): (T | UploadQueueItem)[] {
  const seen = new Set(queue.map((item) => item.relPath));
  const next: (T | UploadQueueItem)[] = [...queue];

  for (const item of items) {
    if (!isAccepted(item.file)) continue;
    if (seen.has(item.relPath)) continue;
    seen.add(item.relPath);
    next.push({ ...item, status: 'pending', loaded: 0 });
  }

  return next;
}

/**
 * Sum the byte sizes of every item in the queue.
 * @param queue The upload queue.
 * @returns The total size in bytes.
 */
export function totalUploadBytes(queue: Pick<UploadQueueItem, 'file'>[]): number {
  return queue.reduce((sum, item) => sum + item.file.size, 0);
}

/**
 * Whether the queue has any items still worth uploading.
 * True when at least one item is `pending` or in the `error` (retryable) state.
 * @param queue The upload queue.
 * @returns `true` if there is uploadable work remaining.
 */
export function hasUploadableItems(queue: Pick<UploadQueueItem, 'status'>[]): boolean {
  return queue.some((item) => item.status === 'pending' || item.status === 'error');
}

/**
 * Choose the primary button label based on remaining work.
 * @param queue The upload queue.
 * @returns `'Upload'` when work remains, otherwise `'Done'`.
 */
export function uploadPrimaryLabel(queue: Pick<UploadQueueItem, 'status'>[]): 'Upload' | 'Done' {
  return hasUploadableItems(queue) ? 'Upload' : 'Done';
}

/**
 * Compute an item's upload completion percentage.
 * @param item The queue item (needs `file.size` and `loaded`).
 * @returns An integer 0–100; 0 for zero-byte files.
 */
export function uploadProgressPercent(item: Pick<UploadQueueItem, 'file' | 'loaded'>): number {
  return item.file.size > 0 ? Math.min(100, Math.round((item.loaded / item.file.size) * 100)) : 0;
}

/**
 * Overall queue progress from completed files plus the active file's loaded bytes.
 * Unlike a simple file-index fraction, this moves continuously while a large
 * PDF/CBZ is streaming so the top progress bar is not stuck at 0% for the
 * entire first file.
 * @param completedBytes Bytes from files already finished (or fully transferred).
 * @param currentLoaded Bytes transferred for the file currently uploading.
 * @param totalBytes Sum of all queued file sizes.
 * @returns An integer 0–100.
 */
export function overallUploadProgressPercent(
  completedBytes: number,
  currentLoaded: number,
  totalBytes: number,
): number {
  if (totalBytes <= 0) return 0;
  const transferred = Math.min(totalBytes, Math.max(0, completedBytes) + Math.max(0, currentLoaded));
  return Math.min(100, Math.round((transferred / totalBytes) * 100));
}

/**
 * Derive the display row state (text, colour class, percent) for an item.
 * Maps each status to user-facing wording and styling: live percent while
 *          uploading, "Processing…" after the body is fully sent (server still
 *          ingesting), "Added"/"Already in library" for done/skipped, the error
 *          message for failures, and an empty label while pending.
 * @param item The queue item to render.
 * @returns The row's display state.
 */
export function uploadRowStatus(item: UploadQueueItem): UploadRowStatus {
  const percent = uploadProgressPercent(item);
  if (item.status === 'uploading') {
    // Body finished; request is still open while the server writes + ingests.
    if (item.file.size > 0 && item.loaded >= item.file.size) {
      return { text: 'Processing…', className: 'text-primary font-bold', percent: 100 };
    }
    return { text: `${percent}%`, className: 'text-primary font-bold', percent };
  }
  if (item.status === 'done') {
    return { text: 'Added', className: 'text-emerald-500 font-bold', percent };
  }
  if (item.status === 'skipped') {
    return { text: 'Already in library', className: 'text-amber-500', percent };
  }
  if (item.status === 'error') {
    return { text: item.error || 'Failed', className: 'text-destructive font-semibold', percent };
  }
  return { text: '', className: 'text-muted-foreground', percent };
}

/**
 * Build the queue summary line (file count and total size).
 * @param queue The upload queue.
 * @returns A `countLabel` (pluralised) and a human-readable `bytesLabel`.
 */
export function uploadQueueSummary(queue: Pick<UploadQueueItem, 'file'>[]): {
  countLabel: string;
  bytesLabel: string;
} {
  return {
    countLabel: `${queue.length} file${queue.length === 1 ? '' : 's'} queued`,
    bytesLabel: formatBytes(totalUploadBytes(queue)),
  };
}
