/**
 * @module
 * Debounced reading-progress sync.
 *
 * All three readers persist progress on every page turn
 * (`api.updateProgress` / `api.updateLocation`). Each call is an HTTP
 * round-trip plus a Postgres write, so fast paging produces a burst of
 * requests. This module coalesces those calls: the latest position per book
 * is held pending and flushed after a short quiet period. The final position
 * is never lost because the readers flush on unmount (component teardown) and
 * the module itself flushes everything when the tab hides or the page unloads.
 *
 * Values are keyed by comic id and kept monotonic within a session — a newer
 * schedule always replaces the pending payload, so the last-read page wins.
 */

import { updateLocation, updateProgress } from './api/reading';

/** The payload shapes the progress endpoint accepts (page vs EPUB location). */
export type ProgressPayload =
  | { page: number }
  | { location: string; percent?: number };

const DEBOUNCE_MS = 800;

interface PendingWrite {
  payload: ProgressPayload;
  timer: ReturnType<typeof setTimeout> | null;
}

const pending = new Map<number, PendingWrite>();

function fire(comicId: number, entry: PendingWrite, keepalive = false): void {
  if (entry.timer !== null) clearTimeout(entry.timer);
  pending.delete(comicId);
  if ('page' in entry.payload) {
    void updateProgress(comicId, entry.payload.page, keepalive).catch(() => {});
  } else {
    void updateLocation(comicId, entry.payload.location, entry.payload.percent, keepalive).catch(() => {});
  }
}

/**
 * Hold the latest position for a book and schedule a trailing flush. Calling
 * again for the same book replaces the pending payload (and restarts the
 * timer), so a burst of page turns collapses into one write.
 */
export function scheduleProgress(comicId: number, payload: ProgressPayload, delayMs = DEBOUNCE_MS): void {
  const entry = pending.get(comicId);
  if (entry && entry.timer !== null) clearTimeout(entry.timer);
  const next: PendingWrite = { payload, timer: null };
  next.timer = setTimeout(() => fire(comicId, next), delayMs);
  pending.set(comicId, next);
}

/** Write the pending position for one book immediately (cancel its timer). */
export function flushProgress(comicId: number, keepalive = false): void {
  const entry = pending.get(comicId);
  if (!entry) return;
  fire(comicId, entry, keepalive);
}

/** Write every pending position immediately. No-op when nothing is pending. */
export function flushAllProgress(keepalive = false): void {
  for (const id of [...pending.keys()]) flushProgress(id, keepalive);
}

// Global safety net: when the tab is hidden or the page is about to unload,
// timers may not fire before the page is frozen or destroyed. Flush
// synchronously so the last-read position is never lost. (Component unmounts
// inside the SPA flush individually; these listeners cover real navigation
// away from the app and mobile backgrounding.)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllProgress(true);
  });
  window.addEventListener('pagehide', () => flushAllProgress(true));
}
