import { API, del, get, post, put } from './client';
import type { ComicListResponse, ComicQueryOptions, MediaType, WebComicRecord } from './types';

export const fetchComics = (options: ComicQueryOptions = {}): Promise<ComicListResponse> =>
  get<ComicListResponse>('/api/comics', { query: options });

/**
 * Fetch the ids of every comic matching the catalog filters, without pagination.
 * Used by the selection bar's "Select all matching" bulk action.
 */
export const fetchMatchingComicIds = (
  options: ComicQueryOptions & { libraryId?: number; folderId?: number },
): Promise<{ ids: number[]; totalCount: number; truncated: boolean }> =>
  get<{ ids: number[]; totalCount: number; truncated: boolean }>('/api/comics/matching-ids', {
    query: options,
  });

/**
 * Queue a background job that re-derives covers for the given comics.
 * Returns a jobId when the server dispatched a job (null when nothing to do).
 */
export const batchRefreshCovers = (ids: number[]): Promise<{ ok: boolean; jobId: string | null }> =>
  post<{ ok: boolean; jobId: string | null }>('/api/comics/batch-refresh-covers', {
    body: { ids },
  });

export const fetchComic = (id: number): Promise<WebComicRecord> =>
  get<WebComicRecord>(`/api/comics/${id}`);

export const deleteComic = (id: number): Promise<void> =>
  del<void>(`/api/comics/${id}`, { parse: 'none' });

/**
 * Repoint a comic record at a new absolute path on disk (admin). Clears any
 * missing-file flag once the server confirms the new path exists.
 */
export const relocateComicPath = (
  comicId: number,
  path: string,
): Promise<{ ok: boolean; filePath: string }> =>
  put<{ ok: boolean; filePath: string }>(`/api/comics/${comicId}/path`, { body: { path } });

export function thumbnailUrl(id: number, width?: number): string {
  return `${API}/api/comics/${id}/thumbnail${width ? `?width=${width | 0}` : ''}`;
}

export function pageUrl(id: number, page: number, width?: number, upscale?: boolean): string {
  const params = new URLSearchParams();
  if (width) params.set('width', String(width | 0));
  if (upscale) params.set('upscale', '1');
  const qs = params.toString();
  return `${API}/api/comics/${id}/pages/${page}${qs ? `?${qs}` : ''}`;
}

export function fileUrl(id: number): string {
  return `${API}/api/comics/${id}/file`;
}

export const fetchRecentlyRead = (limit = 20, mediaType?: MediaType): Promise<WebComicRecord[]> =>
  get<WebComicRecord[]>('/api/recently-read', { query: { limit, mediaType } });

export const fetchContinueReading = (limit = 20, mediaType?: MediaType): Promise<WebComicRecord[]> =>
  get<WebComicRecord[]>('/api/continue-reading', { query: { limit, mediaType } });

export const fetchRecentlyAdded = (limit = 20, mediaType?: MediaType): Promise<WebComicRecord[]> =>
  get<WebComicRecord[]>('/api/recently-added', { query: { limit, mediaType } });

export const refreshBookMetadata = (comicId: number): Promise<void> =>
  post<void>(`/api/comics/${comicId}/refresh-metadata`, { parse: 'none' });

export const getSeries = (): Promise<string[]> =>
  get<string[]>('/api/series');

export const getSeriesComics = (name: string): Promise<WebComicRecord[]> =>
  get<WebComicRecord[]>(`/api/series/${encodeURIComponent(name)}/comics`);

export const addFavorite = (comicId: number): Promise<void> =>
  post<void>(`/api/comics/${comicId}/favorite`, { parse: 'none' });

export const removeFavorite = (comicId: number): Promise<void> =>
  del<void>(`/api/comics/${comicId}/favorite`, { parse: 'none' });
