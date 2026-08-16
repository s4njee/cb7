import { del, get, post, put } from './client';
import type { EnqueueResponse } from './jobs';
import type { WatchedRoot } from './types';

/**
 * Client functions for watched library roots (drop-folder ingest).
 *
 * A watched root is a folder with a registered `scan_path` on the host. The
 * server registers roots via add-path (with a folder label) or by setting a
 * scan path on an existing folder; these helpers list, update, and remove them.
 */

/** List watched roots with their scan status (admin). */
export const fetchWatchedRoots = (): Promise<WatchedRoot[]> =>
  get<WatchedRoot[]>('/api/roots');

/**
 * Update a root: set/clear its scan path (`null`/`''` clears) and/or toggle
 * auto-scan. A newly-set path triggers an immediate incremental scan; the
 * response carries the resulting `jobId` (or `alreadyQueued` when deduped).
 */
export const updateWatchedRoot = (
  folderId: number,
  patch: { scanPath?: string | null; enabled?: boolean },
): Promise<EnqueueResponse> =>
  put<EnqueueResponse>(`/api/roots/${folderId}`, { body: patch });

/** Remove the watch from a folder (keeps the folder and its catalog rows). */
export const removeWatchedRoot = (folderId: number): Promise<void> =>
  del<void>(`/api/roots/${folderId}`, { parse: 'none' });

export interface RescanAllResponse {
  enqueued: number;
  jobs: Array<{ folderId: number; jobId: string | null; alreadyQueued: boolean }>;
}

/** Trigger an incremental scan of every enabled watched root (admin). */
export const rescanAllRoots = (): Promise<RescanAllResponse> =>
  post<RescanAllResponse>('/api/roots/rescan-all', {});

/**
 * Enqueue a rescan of one root without polling. The roots list's own
 * `GET /api/roots` polling reflects the job status afterwards; use
 * {@link rescanFolder} (folders.ts) when you want to block until completion.
 */
export const rescanRoot = (folderId: number): Promise<EnqueueResponse> =>
  post<EnqueueResponse>(`/api/folders/${folderId}/rescan`, {});
