import { del, get, post, put } from './client';

export const fetchTags = (): Promise<string[]> =>
  get<string[]>('/api/tags');

export const setComicTags = (comicId: number, tags: string[]): Promise<void> =>
  put<void>(`/api/comics/${comicId}/tags`, { body: { tags }, parse: 'none' });

export const renameTag = (oldName: string, newName: string): Promise<void> =>
  put<void>(`/api/tags/${encodeURIComponent(oldName)}`, { body: { newName }, parse: 'none' });

export const deleteTag = (name: string): Promise<void> =>
  del<void>(`/api/tags/${encodeURIComponent(name)}`, { parse: 'none' });

export const addTagToComics = (tag: string, comicIds: number[]): Promise<void> =>
  post<void>(`/api/tags/${encodeURIComponent(tag)}/comics`, { body: { comicIds }, parse: 'none' });

export const removeTagFromComics = (tag: string, comicIds: number[]): Promise<void> =>
  del<void>(`/api/tags/${encodeURIComponent(tag)}/comics`, { body: { comicIds }, parse: 'none' });
