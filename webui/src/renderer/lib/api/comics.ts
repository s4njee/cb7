import { API, del, get, post } from './client';
import type { ComicListResponse, ComicQueryOptions, MediaType, WebComicRecord } from './types';

export const fetchComics = (options: ComicQueryOptions = {}): Promise<ComicListResponse> =>
  get<ComicListResponse>('/api/comics', { query: options });

export const fetchComic = (id: number): Promise<WebComicRecord> =>
  get<WebComicRecord>(`/api/comics/${id}`);

export const deleteComic = (id: number): Promise<void> =>
  del<void>(`/api/comics/${id}`, { parse: 'none' });

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
