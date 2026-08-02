import { describe, expect, it } from 'vitest';
import { buildComicMetadataUpdate, rowToComicMetadata } from './comicMetadataHelpers';

describe('comicMetadataHelpers', () => {
  it('builds assignments in stable column order', () => {
    expect(buildComicMetadataUpdate({
      seriesName: 'Saga',
      title: 'Saga Deluxe',
      year: 2012,
      externalSource: 'comicvine',
    })).toEqual({
      assignments: [
        'title = ?',
        'year = ?',
        'external_source = ?',
        'series_name = ?',
      ],
      values: ['Saga Deluxe', 2012, 'comicvine', 'Saga'],
    });
  });

  it('treats null as an explicit SQL value and undefined as unchanged', () => {
    expect(buildComicMetadataUpdate({
      author: null,
      artist: undefined,
      summary: null,
      volumeNumber: null,
    })).toEqual({
      assignments: [
        'author = ?',
        'summary = ?',
        'volume_number = ?',
      ],
      values: [null, null, null],
    });
  });

  it('returns an empty update when no fields are provided', () => {
    expect(buildComicMetadataUpdate({})).toEqual({
      assignments: [],
      values: [],
    });
  });

  it('maps raw database metadata rows to app-facing field names', () => {
    expect(rowToComicMetadata({
      author: 'Brian K. Vaughan',
      artist: 'Fiona Staples',
      genre: null,
      year: 2012,
      summary: 'Space opera',
      external_id: '123',
      external_source: 'comicvine',
      series_name: 'Saga',
      volume_number: 1,
      chapter_number: null,
    })).toEqual({
      author: 'Brian K. Vaughan',
      artist: 'Fiona Staples',
      genre: null,
      year: 2012,
      summary: 'Space opera',
      externalId: '123',
      externalSource: 'comicvine',
      seriesName: 'Saga',
      volumeNumber: 1,
      chapterNumber: null,
    });
  });
});
