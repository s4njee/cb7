import { describe, expect, it } from 'vitest';
import type { MediaRecord } from '../../../shared/types';
import {
  buildOpdsFeed,
  buildOpenSearchDescription,
  buildPublication,
  parseOpdsPaging,
  OPDS_MAX_PAGE_SIZE,
  OPDS_MIME,
} from './opdsFeedHelpers';

function makeRecord(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: 7,
    filePath: '/library/Saga v1.cbz',
    title: 'Saga v1',
    pageCount: 24,
    fileSize: 1024,
    coverThumbnail: null,
    dateAdded: '2026-01-01 00:00:00',
    tags: [],
    lastPage: null,
    lastLocation: null,
    lastPercent: null,
    lastRead: null,
    mediaType: 'comic',
    ...overrides,
  };
}

describe('parseOpdsPaging', () => {
  it('defaults to page 1 / page size 100', () => {
    expect(parseOpdsPaging({})).toEqual({ page: 1, limit: 100, offset: 0 });
  });

  it('parses explicit page and limit, and derives the offset', () => {
    expect(parseOpdsPaging({ page: '3', limit: '25' })).toEqual({ page: 3, limit: 25, offset: 50 });
  });

  it('caps the limit and clamps invalid pages to 1', () => {
    expect(parseOpdsPaging({ page: '0', limit: String(OPDS_MAX_PAGE_SIZE + 100) })).toEqual({
      page: 1,
      limit: OPDS_MAX_PAGE_SIZE,
      offset: 0,
    });
    expect(parseOpdsPaging({ page: 'abc', limit: '-5' })).toEqual({ page: 1, limit: 100, offset: 0 });
  });
});

describe('buildPublication', () => {
  it('emits self + cover links and progress metadata for a started comic', () => {
    const publication = buildPublication(
      makeRecord({ lastPage: 10, lastPercent: 42, lastRead: '2026-02-02 00:00:00' }),
      'http://host:8008',
    );
    expect(publication.metadata).toMatchObject({
      '@type': 'http://schema.org/ComicStory',
      title: 'Saga v1',
      identifier: 'cb8:comic:7',
      numberOfPages: 24,
      percentRead: 42,
      lastPage: 10,
      lastReadAt: '2026-02-02 00:00:00',
    });
    expect(publication.links).toEqual([
      { rel: 'self', href: 'http://host:8008/api/comics/7/manifest', type: 'application/webpub+json' },
      { rel: 'cover', href: 'http://host:8008/api/comics/7/thumbnail', type: 'image/jpeg' },
    ]);
  });

  it('omits progress metadata for an unstarted book', () => {
    const publication = buildPublication(makeRecord({ mediaType: 'book', filePath: '/library/N.epub' }), 'http://host:8008');
    expect(publication.metadata.percentRead).toBeUndefined();
    expect(publication.metadata.lastPage).toBeUndefined();
  });

  it('adds an acquisition link with the right MIME for books', () => {
    const epub = buildPublication(makeRecord({ mediaType: 'book', filePath: '/library/N.epub' }), 'http://host:8008');
    expect(epub.links).toContainEqual({
      rel: 'http://opds-spec.org/acquisition',
      href: 'http://host:8008/api/comics/7/file',
      type: 'application/epub+zip',
    });
    const pdf = buildPublication(makeRecord({ mediaType: 'book', filePath: '/library/N.pdf' }), 'http://host:8008');
    expect(pdf.links).toContainEqual(expect.objectContaining({ type: 'application/pdf' }));
  });

  it('carries an EPUB location for resuming reflowable books', () => {
    const publication = buildPublication(
      makeRecord({ mediaType: 'book', filePath: '/library/N.epub', lastLocation: 'epubcfi(/6/4[foo]!)', lastPercent: 61 }),
      'http://host:8008',
    );
    expect(publication.metadata.lastLocation).toBe('epubcfi(/6/4[foo]!)');
    expect(publication.metadata.percentRead).toBe(61);
  });
});

describe('buildOpdsFeed', () => {
  it('builds a feed with self link, paging metadata, and publications', () => {
    const feed = buildOpdsFeed({
      title: 'All books',
      baseUrl: 'http://host:8008',
      selfPath: '/api/opds/all',
      paging: { page: 1, limit: 100, offset: 0 },
      numberOfItems: 250,
      publications: [buildPublication(makeRecord(), 'http://host:8008')],
    });
    expect(feed.metadata).toMatchObject({ title: 'All books', numberOfItems: 250, itemsPerPage: 100, currentPage: 1 });
    expect(feed.links).toContainEqual({ rel: 'self', href: 'http://host:8008/api/opds/all', type: OPDS_MIME });
    expect(Array.isArray(feed.publications)).toBe(true);
    expect(feed.publications).toHaveLength(1);
  });

  it('adds a next link only when one is supplied', () => {
    const withNext = buildOpdsFeed({ title: 't', baseUrl: 'http://h', selfPath: '/api/opds/all', nextPath: '/api/opds/all?page=2&limit=100' });
    expect(withNext.links).toContainEqual({ rel: 'next', href: 'http://h/api/opds/all?page=2&limit=100', type: OPDS_MIME });

    const withoutNext = buildOpdsFeed({ title: 't', baseUrl: 'http://h', selfPath: '/api/opds/all' });
    expect(withoutNext.links.some((l) => l.rel === 'next')).toBe(false);
  });
});

describe('buildOpenSearchDescription', () => {
  it('advertises the search endpoint with the OPDS content type', () => {
    const xml = buildOpenSearchDescription('http://host:8008');
    expect(xml).toContain('<OpenSearchDescription');
    expect(xml).toContain('<ShortName>CB8</ShortName>');
    expect(xml).toContain('http://host:8008/api/opds/search?q={searchTerms}');
    expect(xml).toContain(OPDS_MIME);
  });
});
