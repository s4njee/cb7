import { del, get, post, put } from './client';
import type { ComicListResponse, ComicQueryOptions, Library, MediaType } from './types';

export const fetchLibraries = (mediaType?: MediaType): Promise<Library[]> =>
  get<Library[]>('/api/libraries', { query: { mediaType } });

export const createLibrary = (name: string, mediaType: MediaType): Promise<Library> =>
  post<Library>('/api/libraries', { body: { name, mediaType } });

export const renameLibrary = (id: number, name: string): Promise<Library> =>
  put<Library>(`/api/libraries/${id}`, { body: { name } });

export const deleteLibrary = (id: number): Promise<void> =>
  del<void>(`/api/libraries/${id}`, { parse: 'none' });

export const addComicsToLibrary = (libraryId: number, comicIds: number[]): Promise<void> =>
  post<void>(`/api/libraries/${libraryId}/comics`, { body: { comicIds }, parse: 'none' });

export const removeComicsFromLibrary = (libraryId: number, comicIds: number[]): Promise<void> =>
  del<void>(`/api/libraries/${libraryId}/comics`, { body: { comicIds }, parse: 'none' });

export const addFoldersToLibrary = (libraryId: number, folderIds: number[]): Promise<void> =>
  post<void>(`/api/libraries/${libraryId}/folders`, { body: { folderIds }, parse: 'none' });

export const fetchLibraryComics = (libraryId: number, options: ComicQueryOptions = {}): Promise<ComicListResponse> =>
  get<ComicListResponse>(`/api/libraries/${libraryId}/comics`, { query: options });
