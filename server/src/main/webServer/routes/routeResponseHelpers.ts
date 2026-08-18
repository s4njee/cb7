import type { MediaRecord } from '../../../shared/types';
import { toWebRecord, type WebComicRecord } from '../mapping';

/**
 * @module
 * Shared Route Response Helpers
 *
 * Architecture overview for Junior Devs:
 * Several route files return paged comic/book lists. The database returns
 * internal `MediaRecord` objects; the API must send safe web records and attach
 * a `favorited` boolean even when the query did not provide one. Keeping that
 * response shape here prevents tiny route-to-route differences.
 */

export type PagedComicResult = {
  records: Array<MediaRecord & { favorited?: boolean }>;
  totalCount: number;
};

export type PagedComicResponse = {
  records: Array<WebComicRecord & { favorited: boolean }>;
  totalCount: number;
};

export function formatPagedComicResponse(result: PagedComicResult): PagedComicResponse {
  return {
    records: result.records.map((record) => ({
      ...toWebRecord(record)!,
      favorited: record.favorited ?? false,
    })),
    totalCount: result.totalCount,
  };
}
