import { describe, expect, it } from 'vitest';
import { comicCaption, isFinished, progressPercentFor } from './utils';

function record(overrides: Partial<Parameters<typeof comicCaption>[0]> = {}) {
  return {
    fileExt: 'cbz',
    mediaType: 'comic' as const,
    pageCount: 0,
    lastPage: null,
    lastPercent: null,
    ...overrides,
  };
}

describe('comicCaption', () => {
  it('labels finished page-based items', () => {
    expect(comicCaption(record({ pageCount: 24, lastPage: 23 }))).toBe('Finished');
  });

  it('labels finished reflowable items', () => {
    expect(comicCaption(record({ fileExt: 'epub', mediaType: 'book', lastPercent: 100 }))).toBe('Finished');
  });

  it('shows the page position for in-progress page-based items', () => {
    expect(comicCaption(record({ pageCount: 24, lastPage: 4 }))).toBe('Page 5 of 24');
  });

  it('shows the rounded percentage for in-progress reflowable items', () => {
    expect(comicCaption(record({ fileExt: 'epub', mediaType: 'book', lastPercent: 41.6 }))).toBe('42% read');
  });

  it('shows format and page count for unstarted comics', () => {
    expect(comicCaption(record({ pageCount: 24 }))).toBe('CBZ · 24 pages');
  });

  it('shows format and chapter count for unstarted books', () => {
    expect(comicCaption(record({ fileExt: 'epub', mediaType: 'book', pageCount: 12 }))).toBe('EPUB · 12 chapters');
  });

  it('uses the singular unit for a single page', () => {
    expect(comicCaption(record({ pageCount: 1 }))).toBe('CBZ · 1 page');
  });

  it('omits the count when the page count is unknown', () => {
    expect(comicCaption(record({ fileExt: 'epub', mediaType: 'book' }))).toBe('EPUB');
  });
});

describe('isFinished', () => {
  it('treats the last page as finished', () => {
    expect(isFinished({ pageCount: 24, lastPage: 23, lastPercent: null })).toBe(true);
    expect(isFinished({ pageCount: 24, lastPage: 22, lastPercent: null })).toBe(false);
  });

  it('treats 100 percent as finished', () => {
    expect(isFinished({ pageCount: 0, lastPage: null, lastPercent: 100 })).toBe(true);
    expect(isFinished({ pageCount: 0, lastPage: null, lastPercent: 99 })).toBe(false);
  });
});

describe('progressPercentFor', () => {
  it('derives the percentage from the 0-indexed last page', () => {
    expect(progressPercentFor({ pageCount: 200, lastPage: 99, lastPercent: null })).toBe(50);
  });

  it('floors page-based progress at 1 percent once started', () => {
    expect(progressPercentFor({ pageCount: 1000, lastPage: 0, lastPercent: null })).toBe(1);
  });

  it('uses the whole-book percentage for reflowable items', () => {
    expect(progressPercentFor({ pageCount: 0, lastPage: null, lastPercent: 37.4 })).toBe(37);
  });

  it('reports zero for unstarted items', () => {
    expect(progressPercentFor({ pageCount: 24, lastPage: null, lastPercent: null })).toBe(0);
  });
});
