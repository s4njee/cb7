import { get, post, put } from './client';
import type {
  BatchMetadataFields,
  MetadataApplyResponse,
  MetadataCandidate,
  MetadataSearchResponse,
} from './types';

export const searchMetadata = (comicId: number, query: string, sources?: string[]): Promise<MetadataSearchResponse> =>
  get<MetadataSearchResponse>(`/api/comics/${comicId}/metadata-search`, {
    query: { q: query, sources: sources?.length ? sources.join(',') : undefined },
  });

export const applyMetadata = (comicId: number, metadata: MetadataCandidate): Promise<MetadataApplyResponse> =>
  put<MetadataApplyResponse>(`/api/comics/${comicId}/metadata`, { body: metadata });

/**
 * Re-read embedded metadata (from the file itself) and apply it to a comic.
 * Returns the map of field names to values that were applied.
 */
export const refreshEmbeddedMetadata = (
  comicId: number,
): Promise<{ ok: boolean; fields: Record<string, string | number | null> }> =>
  post<{ ok: boolean; fields: Record<string, string | number | null> }>(
    `/api/comics/${comicId}/refresh-embedded-metadata`,
  );

/**
 * Write a subset of metadata fields onto many comics at once.
 * Fields omitted from `fields` are left untouched on each comic.
 */
export const batchUpdateMetadata = (
  ids: number[],
  fields: BatchMetadataFields,
): Promise<{ ok: boolean }> =>
  put<{ ok: boolean }>('/api/comics/batch-metadata', { body: { ids, fields } });
