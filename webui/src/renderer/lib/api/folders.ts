import { del, get, post, put } from './client';
import { pollIngestJob, type EnqueueResponse } from './jobs';
import type {
  ChapterGroup,
  ComicListResponse,
  ComicQueryOptions,
  Folder,
  GroupResponse,
  HierarchyQueryOptions,
  IngestProgress,
  IngestProgressEvent,
  SeriesGroup,
  VolumeGroup,
} from './types';

export const fetchFolders = (): Promise<Folder[]> =>
  get<Folder[]>('/api/folders');

export const fetchFolderComics = (folderId: number, options: ComicQueryOptions = {}): Promise<ComicListResponse> =>
  get<ComicListResponse>(`/api/folders/${folderId}/comics`, { query: options });

export const fetchFolderSeries = (folderId: number, options: HierarchyQueryOptions = {}): Promise<GroupResponse<SeriesGroup>> =>
  get<GroupResponse<SeriesGroup>>(`/api/folders/${folderId}/series`, { query: options });

export const fetchFolderSeriesVolumes = (
  folderId: number,
  seriesKey: string,
  options: HierarchyQueryOptions = {},
): Promise<GroupResponse<VolumeGroup>> =>
  get<GroupResponse<VolumeGroup>>(`/api/folders/${folderId}/series/${encodeURIComponent(seriesKey)}/volumes`, { query: options });

export const fetchFolderVolumeChapters = (
  folderId: number,
  seriesKey: string,
  volumeKey: string,
  options: HierarchyQueryOptions = {},
): Promise<GroupResponse<ChapterGroup>> =>
  get<GroupResponse<ChapterGroup>>(
    `/api/folders/${folderId}/series/${encodeURIComponent(seriesKey)}/volumes/${encodeURIComponent(volumeKey)}/chapters`,
    { query: options },
  );

export const fetchFolderVolumeComics = (
  folderId: number,
  seriesKey: string,
  volumeKey: string,
  options: ComicQueryOptions = {},
): Promise<ComicListResponse> =>
  get<ComicListResponse>(
    `/api/folders/${folderId}/series/${encodeURIComponent(seriesKey)}/volumes/${encodeURIComponent(volumeKey)}/comics`,
    { query: options },
  );

export const fetchFolderChapterComics = (
  folderId: number,
  seriesKey: string,
  volumeKey: string,
  chapterKey: string,
  options: ComicQueryOptions = {},
): Promise<ComicListResponse> =>
  get<ComicListResponse>(
    `/api/folders/${folderId}/series/${encodeURIComponent(seriesKey)}/volumes/${encodeURIComponent(volumeKey)}/chapters/${encodeURIComponent(chapterKey)}/comics`,
    { query: options },
  );

export const createFolder = (name: string, comicIds: number[] = []): Promise<Folder> =>
  post<Folder>('/api/folders', { body: { name, comicIds } });

export const renameFolder = (id: number, name: string): Promise<Folder> =>
  put<Folder>(`/api/folders/${id}`, { body: { name } });

export const deleteFolder = (id: number): Promise<void> =>
  del<void>(`/api/folders/${id}`, { parse: 'none' });

export const addComicsToFolder = (folderId: number, comicIds: number[]): Promise<void> =>
  post<void>(`/api/folders/${folderId}/comics`, { body: { comicIds }, parse: 'none' });

export const removeComicsFromFolder = (folderId: number, comicIds: number[]): Promise<void> =>
  del<void>(`/api/folders/${folderId}/comics`, { body: { comicIds }, parse: 'none' });

export const rescanFolder = async (
  folderId: number,
  onProgress?: (event: IngestProgressEvent) => void,
): Promise<IngestProgress> => {
  const res = await post<EnqueueResponse>(`/api/folders/${folderId}/rescan`, {});
  if (!res.jobId) return { added: 0, errors: [], failuresSummary: null };
  return pollIngestJob(res.jobId, onProgress);
};
