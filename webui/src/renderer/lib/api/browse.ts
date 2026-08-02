import { get } from './client';
import type {
  ChapterGroup,
  ComicListResponse,
  ComicQueryOptions,
  GroupResponse,
  HierarchyQueryOptions,
  SeriesGroup,
  VolumeGroup,
} from './types';

export const fetchBrowseSeries = (options: HierarchyQueryOptions = {}): Promise<GroupResponse<SeriesGroup>> =>
  get<GroupResponse<SeriesGroup>>('/api/browse/series', { query: options });

export const fetchBrowseSeriesVolumes = (
  seriesKey: string,
  options: HierarchyQueryOptions = {},
): Promise<GroupResponse<VolumeGroup>> =>
  get<GroupResponse<VolumeGroup>>(`/api/browse/series/${encodeURIComponent(seriesKey)}/volumes`, { query: options });

export const fetchBrowseVolumeChapters = (
  seriesKey: string,
  volumeKey: string,
  options: HierarchyQueryOptions = {},
): Promise<GroupResponse<ChapterGroup>> =>
  get<GroupResponse<ChapterGroup>>(
    `/api/browse/series/${encodeURIComponent(seriesKey)}/volumes/${encodeURIComponent(volumeKey)}/chapters`,
    { query: options },
  );

export const fetchBrowseVolumeComics = (
  seriesKey: string,
  volumeKey: string,
  options: ComicQueryOptions = {},
): Promise<ComicListResponse> =>
  get<ComicListResponse>(
    `/api/browse/series/${encodeURIComponent(seriesKey)}/volumes/${encodeURIComponent(volumeKey)}/comics`,
    { query: options },
  );

export const fetchBrowseChapterComics = (
  seriesKey: string,
  volumeKey: string,
  chapterKey: string,
  options: ComicQueryOptions = {},
): Promise<ComicListResponse> =>
  get<ComicListResponse>(
    `/api/browse/series/${encodeURIComponent(seriesKey)}/volumes/${encodeURIComponent(volumeKey)}/chapters/${encodeURIComponent(chapterKey)}/comics`,
    { query: options },
  );
