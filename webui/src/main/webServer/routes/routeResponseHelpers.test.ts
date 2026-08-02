import { describe, expect, it } from 'vitest';
import type { MediaRecord } from '../../../shared/types';
import { formatPagedComicResponse } from './routeResponseHelpers';

function record(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: 1,
    filePath: '/library/Saga/Issue 001.cbz',
    title: 'Saga #1',
    pageCount: 32,
    fileSize: 1024,
    coverThumbnail: null,
    dateAdded: '2026-06-19T12:00:00.000Z',
    tags: ['space'],
    lastPage: null,
    lastLocation: null,
    lastPercent: null,
    lastRead: null,
    mediaType: 'comic',
    ...overrides,
  };
}

describe('routeResponseHelpers', () => {
  it('formats paged comic query results as safe web records', () => {
    expect(formatPagedComicResponse({
      records: [record()],
      totalCount: 1,
    })).toEqual({
      records: [{
        id: 1,
        title: 'Saga #1',
        pageCount: 32,
        fileSize: 1024,
        dateAdded: '2026-06-19T12:00:00.000Z',
        tags: ['space'],
        lastPage: null,
        lastLocation: null,
        lastPercent: null,
        lastRead: null,
        mediaType: 'comic',
        thumbnailUrl: '/api/comics/1/thumbnail?v=1781870400000',
        fileExt: 'cbz',
        favorited: false,
      }],
      totalCount: 1,
    });
  });

  it('preserves explicit favorite overlays from user-scoped queries', () => {
    expect(formatPagedComicResponse({
      records: [{ ...record({ id: 2, filePath: '/library/book.epub' }), favorited: true }],
      totalCount: 3,
    }).records[0]).toMatchObject({
      id: 2,
      fileExt: 'epub',
      favorited: true,
    });
  });
});
