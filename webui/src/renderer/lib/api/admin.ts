import { API, ApiError, del, get, post } from './client';
import { pollIngestJob, type EnqueueResponse } from './jobs';
import type {
  AdminListDirResponse,
  ClearLibraryResponse,
  HostInfo,
  IngestErrorLogResponse,
  IngestProgress,
  IngestProgressEvent,
  UploadResponse,
} from './types';

export const adminHostInfo = (): Promise<HostInfo> =>
  get<HostInfo>('/api/admin/host-info');

export const adminPickPath = (kind: 'file' | 'directory'): Promise<{ path: string | null }> =>
  post<{ path: string | null }>('/api/admin/pick-path', { body: { kind } });

export const adminListDir = (partialPath: string): Promise<AdminListDirResponse> =>
  get<AdminListDirResponse>('/api/admin/list-dir', { query: { path: partialPath } });

export async function adminAddPath(
  targetPath: string,
  onProgress?: (event: IngestProgressEvent) => void,
  opts: { folderName?: string; useFolderNamesAsSeries?: boolean } = {},
): Promise<IngestProgress> {
  const body: { path: string; folderName?: string; useFolderNamesAsSeries?: boolean } = { path: targetPath };
  if (opts.folderName) body.folderName = opts.folderName;
  if (opts.useFolderNamesAsSeries) body.useFolderNamesAsSeries = true;
  // Enqueue a background scan, then poll the job for progress. The heavy work
  // runs in the cb8-worker process, so this no longer holds the request open.
  const res = await post<EnqueueResponse>('/api/admin/add-path', { body });
  if (!res.jobId) return { added: 0, errors: [], failuresSummary: null };
  return pollIngestJob(res.jobId, onProgress);
}

export const adminGetIngestErrors = (limit = 50): Promise<IngestErrorLogResponse> =>
  get<IngestErrorLogResponse>('/api/admin/ingest-errors', { query: { limit } });

export const adminClearIngestErrors = (): Promise<void> =>
  del<void>('/api/admin/ingest-errors', { parse: 'none' });

export const clearLibrary = (): Promise<ClearLibraryResponse> =>
  del<ClearLibraryResponse>('/api/admin/library');

export type AdminUploadProgress = {
  /** Bytes sent so far (may exceed `file.size` briefly; callers should clamp). */
  loaded: number;
  /** Expected total; prefers XHR total, falls back to `file.size`. */
  total: number;
  /**
   * `uploading` while the request body is in flight; `processing` after the
   * body has fully left the browser and the server is still responding
   * (disk write + ingest).
   */
  phase: 'uploading' | 'processing';
};

export function adminUploadFile(
  file: File,
  relPath: string,
  onProgress?: (progress: AdminUploadProgress) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/api/admin/upload`);
    xhr.responseType = 'json';
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-CB8-Filename', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-CB8-Relpath', encodeURIComponent(relPath || file.name));

    const report = (loaded: number, total: number, phase: AdminUploadProgress['phase']) => {
      onProgress?.({ loaded, total: total > 0 ? total : file.size, phase });
    };

    // Prefer lengthComputable totals, but always report `loaded` — some
    // environments leave lengthComputable false and the old guard hid all
    // progress for the entire transfer (UI stuck at 0% until the response).
    xhr.upload.onprogress = (e) => {
      const total = e.lengthComputable && e.total > 0 ? e.total : file.size;
      report(e.loaded, total, 'uploading');
    };
    xhr.upload.onload = () => {
      report(file.size, file.size, 'processing');
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((xhr.response || {}) as UploadResponse);
      } else {
        reject(new ApiError(xhr.response?.error || `HTTP ${xhr.status}`, { status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onabort = () => reject(new Error('Upload aborted'));
    xhr.send(file);
  });
}
