import { del, get, post, put } from './client';
import type { Bookmark, HistoryResponse } from './types';

/** Per-user reading summary from `GET /api/stats` (P1-7). */
export interface ReadingStats {
  pages: { week: number; month: number; year: number };
  sessions: { week: number; month: number; year: number };
  /** Consecutive days with a reading action. */
  streak: number;
  topAuthors: Array<{ name: string; count: number }>;
  topSeries: Array<{ name: string; count: number }>;
}

export const updateProgress = (id: number, page: number, keepalive = false): Promise<void> =>
  put<void>(`/api/comics/${id}/progress`, { body: { page }, parse: 'none', keepalive });

export const updateLocation = (
  id: number,
  location: string,
  percent?: number,
  keepalive = false,
): Promise<void> =>
  put<void>(`/api/comics/${id}/progress`, {
    body: percent === undefined ? { location } : { location, percent },
    parse: 'none',
    keepalive,
  });

export const clearProgress = (comicId: number): Promise<void> =>
  del<void>(`/api/comics/${comicId}/progress`, { parse: 'none' });

export const setCompleted = (comicId: number, completed: boolean): Promise<void> =>
  put<void>(`/api/comics/${comicId}/progress`, { body: { completed }, parse: 'none' });

export async function getBookmarks(comicId: number): Promise<Bookmark[]> {
  try {
    return await get<Bookmark[]>(`/api/comics/${comicId}/bookmarks`);
  } catch {
    return [];
  }
}

export const createBookmark = (comicId: number, page: number, note: string | null = null): Promise<Bookmark> =>
  post<Bookmark>(`/api/comics/${comicId}/bookmarks`, { body: { page, note } });

export const updateBookmark = (comicId: number, bookmarkId: number, note: string): Promise<void> =>
  put<void>(`/api/comics/${comicId}/bookmarks/${bookmarkId}`, { body: { note }, parse: 'none' });

export const deleteBookmark = (comicId: number, bookmarkId: number): Promise<void> =>
  del<void>(`/api/comics/${comicId}/bookmarks/${bookmarkId}`, { parse: 'none' });

export const logHistory = (comicId: number, action: string, page: number | null = null): Promise<void> =>
  post<void>('/api/history', { body: { comicId, action, page }, parse: 'none' });

export const getHistory = (offset = 0, limit = 50): Promise<HistoryResponse> =>
  get<HistoryResponse>('/api/history', { query: { offset, limit } });

export const fetchReadingStats = (): Promise<ReadingStats> => get<ReadingStats>('/api/stats');
