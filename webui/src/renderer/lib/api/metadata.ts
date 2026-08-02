import { get, put } from './client';
import type { MetadataApplyResponse, MetadataCandidate, MetadataSearchResponse } from './types';

export const searchMetadata = (comicId: number, query: string, sources?: string[]): Promise<MetadataSearchResponse> =>
  get<MetadataSearchResponse>(`/api/comics/${comicId}/metadata-search`, {
    query: { q: query, sources: sources?.length ? sources.join(',') : undefined },
  });

export const applyMetadata = (comicId: number, metadata: MetadataCandidate): Promise<MetadataApplyResponse> =>
  put<MetadataApplyResponse>(`/api/comics/${comicId}/metadata`, { body: metadata });
