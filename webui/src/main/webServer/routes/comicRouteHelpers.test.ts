import { describe, expect, it } from 'vitest';
import {
  bookMimeForPath,
  normalizeMetadataGenre,
  pageExtensionForFilename,
  pageMimeForFilename,
  parseByteRange,
  parseComicRouteOptions,
  parseMetadataSources,
  parsePositiveWidthParam,
} from './comicRouteHelpers';

describe('parseByteRange', () => {
  it('returns null when no Range header is present', () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
  });

  it('returns null for unparseable or multi-range headers (serve whole file)', () => {
    expect(parseByteRange('bytes=abc', 1000)).toBeNull();
    expect(parseByteRange('bytes=0-99,200-299', 1000)).toBeNull();
  });

  it('parses an explicit start-end range', () => {
    expect(parseByteRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
    expect(parseByteRange('bytes=200-399', 1000)).toEqual({ start: 200, end: 399 });
  });

  it('parses an open-ended range to EOF', () => {
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('parses a suffix range (last N bytes)', () => {
    expect(parseByteRange('bytes=-300', 1000)).toEqual({ start: 700, end: 999 });
    expect(parseByteRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('clamps an end that runs past the file size', () => {
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('flags unsatisfiable ranges as invalid', () => {
    expect(parseByteRange('bytes=-', 1000)).toBe('invalid');
    expect(parseByteRange('bytes=1000-1100', 1000)).toBe('invalid');
    expect(parseByteRange('bytes=600-500', 1000)).toBe('invalid');
    expect(parseByteRange('bytes=-0', 1000)).toBe('invalid');
  });
});

describe('comicRouteHelpers', () => {
  it('parses comic list route options with defaults and optional filters', () => {
    expect(parseComicRouteOptions({})).toEqual({ limit: 50 });
    expect(parseComicRouteOptions({
      search: 'saga',
      limit: '500',
      readStatus: 'completed',
      favorites: 'true',
      fileExt: '.CBZ',
    })).toEqual({
      search: 'saga',
      limit: 200,
      readStatus: 'completed',
      favorites: true,
      fileExt: 'cbz',
    });
    expect(parseComicRouteOptions({ readStatus: 'bogus', favorites: 'false' })).toEqual({ limit: 50 });
  });

  it('maps page filenames to extensions and response MIME types', () => {
    expect(pageExtensionForFilename('Page 01.JPG')).toBe('jpg');
    expect(pageMimeForFilename('Page 01.JPG')).toBe('image/jpeg');
    expect(pageMimeForFilename('scan.jxl')).toBe('image/png');
    expect(pageMimeForFilename('unknown.tiff')).toBe('image/png');
    expect(pageMimeForFilename(undefined)).toBe('image/png');
  });

  it('maps book paths to response MIME types', () => {
    expect(bookMimeForPath('/books/story.epub')).toBe('application/epub+zip');
    expect(bookMimeForPath('/books/story.PDF')).toBe('application/pdf');
    expect(bookMimeForPath('/books/story.mobi')).toBe('application/x-mobipocket-ebook');
    expect(bookMimeForPath('/books/story.txt')).toBe('application/octet-stream');
  });

  it('filters metadata source query values to supported providers', () => {
    expect(parseMetadataSources('comicvine, nope, anilist, mangadex')).toEqual(['comicvine', 'anilist', 'mangadex']);
    expect(parseMetadataSources('')).toEqual([]);
  });

  it('parses optional positive resize widths', () => {
    expect(parsePositiveWidthParam(undefined)).toBeNull();
    expect(parsePositiveWidthParam('0')).toBeNull();
    expect(parsePositiveWidthParam('-100')).toBeNull();
    expect(parsePositiveWidthParam('wide')).toBeNull();
    expect(parsePositiveWidthParam('320')).toBe(320);
  });

  it('normalizes metadata genre payloads', () => {
    expect(normalizeMetadataGenre(undefined)).toEqual({ ok: true, value: undefined });
    expect(normalizeMetadataGenre(null)).toEqual({ ok: true, value: null });
    expect(normalizeMetadataGenre('Drama')).toEqual({ ok: true, value: 'Drama' });
    expect(normalizeMetadataGenre(['Drama', 'Sci-Fi'])).toEqual({ ok: true, value: '["Drama","Sci-Fi"]' });
    expect(normalizeMetadataGenre(['Drama', 42])).toEqual({ ok: false, error: '"genre" array must contain strings only' });
    expect(normalizeMetadataGenre(42)).toEqual({ ok: false, error: '"genre" must be string, array, or null' });
  });
});
