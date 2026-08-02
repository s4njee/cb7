import { describe, expect, it } from 'vitest';
import {
  buildLibraryComicQueryOptions,
  mediaTypeForNewLibrary,
} from './libraryRouteHelpers';

describe('libraryRouteHelpers', () => {
  it('defaults new libraries to comics unless book is explicit', () => {
    expect(mediaTypeForNewLibrary('book')).toBe('book');
    expect(mediaTypeForNewLibrary('comic')).toBe('comic');
    expect(mediaTypeForNewLibrary('anything-else')).toBe('comic');
    expect(mediaTypeForNewLibrary(undefined)).toBe('comic');
  });

  it('adds library scope and default limit to comic queries', () => {
    expect(buildLibraryComicQueryOptions({ sortBy: 'title' }, {}, 12)).toEqual({
      sortBy: 'title',
      libraryId: 12,
      limit: 50,
    });
  });

  it('preserves explicit limit values and overlays supported filters', () => {
    expect(buildLibraryComicQueryOptions(
      { limit: 25, offset: 50 },
      { readStatus: 'completed', favorites: 'true' },
      4
    )).toEqual({
      limit: 25,
      offset: 50,
      libraryId: 4,
      readStatus: 'completed',
      favorites: true,
    });
  });

  it('ignores unsupported read statuses and non-true favorites flags', () => {
    expect(buildLibraryComicQueryOptions(
      {},
      { readStatus: 'half-read', favorites: 'false' },
      4
    )).toEqual({
      libraryId: 4,
      limit: 50,
    });
  });
});
