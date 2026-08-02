import { describe, it, expect } from 'vitest';
import { parseSeriesFromFilename, normalizeSeriesName, stripLeadingReleaseDate } from './seriesParser';

describe('parseSeriesFromFilename', () => {
  describe('volume markers', () => {
    it('parses "Title v01"', () => {
      expect(parseSeriesFromFilename('Berserk v01.cbz')).toEqual({
        seriesName: 'Berserk', volumeNumber: 1, chapterNumber: null,
      });
    });

    it('parses "Title Vol. 3"', () => {
      expect(parseSeriesFromFilename('Vinland Saga - Vol. 12.cbz')).toEqual({
        seriesName: 'Vinland Saga', volumeNumber: 12, chapterNumber: null,
      });
    });

    it('parses "Title Volume 5"', () => {
      expect(parseSeriesFromFilename('One Piece Volume 5.cbz')).toEqual({
        seriesName: 'One Piece', volumeNumber: 5, chapterNumber: null,
      });
    });

    it('parses decimal volume numbers', () => {
      expect(parseSeriesFromFilename('Title v1.5.cbz')).toMatchObject({
        seriesName: 'Title', volumeNumber: 1.5,
      });
    });
  });

  describe('chapter markers', () => {
    it('parses "Title #005"', () => {
      expect(parseSeriesFromFilename('Saga #005.cbz')).toEqual({
        seriesName: 'Saga', volumeNumber: null, chapterNumber: 5,
      });
    });

    it('parses "Title c001"', () => {
      expect(parseSeriesFromFilename('Attack on Titan c139.cbz')).toEqual({
        seriesName: 'Attack on Titan', volumeNumber: null, chapterNumber: 139,
      });
    });

    it('parses "Title Ch. 12"', () => {
      expect(parseSeriesFromFilename('Title Ch. 12.cbz')).toMatchObject({
        seriesName: 'Title', chapterNumber: 12,
      });
    });

    it('parses chapter range as the starting chapter', () => {
      expect(parseSeriesFromFilename('Bleach c001-005.cbz')).toEqual({
        seriesName: 'Bleach', volumeNumber: null, chapterNumber: 1,
      });
    });
  });

  describe('combined volume + chapter', () => {
    it('parses "Title Vol. 3 Ch. 12"', () => {
      expect(parseSeriesFromFilename('Title Vol. 3 Ch. 12.cbz')).toEqual({
        seriesName: 'Title', volumeNumber: 3, chapterNumber: 12,
      });
    });

    it('parses "Title v01 c001"', () => {
      expect(parseSeriesFromFilename('Naruto v01 c001.cbz')).toEqual({
        seriesName: 'Naruto', volumeNumber: 1, chapterNumber: 1,
      });
    });
  });

  describe('year stripping', () => {
    it('strips "(2020)" before chapter marker', () => {
      expect(parseSeriesFromFilename('Title (2020) #01.cbz')).toEqual({
        seriesName: 'Title', volumeNumber: null, chapterNumber: 1,
      });
    });
  });

  describe('scanlation group tag', () => {
    it('strips a leading "[Group]" tag', () => {
      expect(parseSeriesFromFilename('[Stick] Berserk v01.cbz')).toEqual({
        seriesName: 'Berserk', volumeNumber: 1, chapterNumber: null,
      });
    });

    it('strips a leading "(Group)" tag', () => {
      expect(parseSeriesFromFilename('(Group) Title v03.cbz')).toEqual({
        seriesName: 'Title', volumeNumber: 3, chapterNumber: null,
      });
    });
  });

  describe('trailing metadata tags', () => {
    it('strips "(Digital)" between series and volume', () => {
      // metadata after volume is already excluded by the cut, but this covers
      // the case where tags appear before the first marker.
      expect(parseSeriesFromFilename('Title (Group) v03.cbz')).toEqual({
        seriesName: 'Title', volumeNumber: 3, chapterNumber: null,
      });
    });

    it('strips multiple trailing tags', () => {
      expect(parseSeriesFromFilename('Title (Group) (Digital) v03.cbz')).toEqual({
        seriesName: 'Title', volumeNumber: 3, chapterNumber: null,
      });
    });
  });

  describe('filename normalization', () => {
    it('replaces underscores with spaces', () => {
      expect(parseSeriesFromFilename('Attack_on_Titan_c139.cbz')).toEqual({
        seriesName: 'Attack on Titan', volumeNumber: null, chapterNumber: 139,
      });
    });

    it('strips trailing separators', () => {
      expect(parseSeriesFromFilename('Title - v01.cbz')).toEqual({
        seriesName: 'Title', volumeNumber: 1, chapterNumber: null,
      });
    });
  });

  describe('series with numeric names', () => {
    it('does not eat digits in "7SEEDS"', () => {
      expect(parseSeriesFromFilename('7SEEDS v04.cbz')).toEqual({
        seriesName: '7SEEDS', volumeNumber: 4, chapterNumber: null,
      });
    });

    it('does not eat digits in "20th Century Boys"', () => {
      expect(parseSeriesFromFilename('20th Century Boys v01.cbz')).toEqual({
        seriesName: '20th Century Boys', volumeNumber: 1, chapterNumber: null,
      });
    });
  });

  describe('leading release-date prefix', () => {
    it('strips YYYYMM and captures bare trailing issue (X-Force scans)', () => {
      expect(parseSeriesFromFilename('199305 X-Force v1 022.cbz')).toEqual({
        seriesName: 'X-Force', volumeNumber: 1, chapterNumber: 22,
      });
      expect(parseSeriesFromFilename('199210 X-Force v1 015.cbz')).toEqual({
        seriesName: 'X-Force', volumeNumber: 1, chapterNumber: 15,
      });
    });

    it('strips YYYY-only prefix', () => {
      expect(parseSeriesFromFilename('2010 Spider-Man v01.cbz')).toMatchObject({
        seriesName: 'Spider-Man', volumeNumber: 1,
      });
    });

    it('strips YYYYMMDD prefix', () => {
      expect(parseSeriesFromFilename('19930512 X-Force v1 022.cbz')).toMatchObject({
        seriesName: 'X-Force', volumeNumber: 1, chapterNumber: 22,
      });
    });
  });

  describe('bare issue after volume marker', () => {
    it('captures "v1 022" as issue 22', () => {
      expect(parseSeriesFromFilename('X-Force v1 022.cbz')).toEqual({
        seriesName: 'X-Force', volumeNumber: 1, chapterNumber: 22,
      });
    });

    it('does not mistake a trailing year for an issue', () => {
      // 4 digits → too long for the issue heuristic; chapter stays null.
      expect(parseSeriesFromFilename('Title v01 1998.cbz')).toMatchObject({
        seriesName: 'Title', volumeNumber: 1, chapterNumber: null,
      });
    });
  });

  describe('no-match fallback', () => {
    it('returns all-null for a bare title', () => {
      expect(parseSeriesFromFilename('Standalone Book.cbz')).toEqual({
        seriesName: null, volumeNumber: null, chapterNumber: null,
      });
    });

    it('returns all-null for a bare trailing number', () => {
      // Bare numbers without v/c/ch/# prefix are intentionally not matched.
      expect(parseSeriesFromFilename('Bleach 001.cbz')).toEqual({
        seriesName: null, volumeNumber: null, chapterNumber: null,
      });
    });

    it('returns all-null for empty input', () => {
      expect(parseSeriesFromFilename('')).toEqual({
        seriesName: null, volumeNumber: null, chapterNumber: null,
      });
    });
  });
});

describe('normalizeSeriesName', () => {
  it('collapses internal whitespace', () => {
    expect(normalizeSeriesName('One   Piece')).toBe('One Piece');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeSeriesName('  Berserk  ')).toBe('Berserk');
  });
});

describe('stripLeadingReleaseDate', () => {
  it('strips a YYYYMM prefix', () => {
    expect(stripLeadingReleaseDate('199305 X-Force v1 022')).toBe('X-Force v1 022');
  });

  it('strips a YYYY-only prefix', () => {
    expect(stripLeadingReleaseDate('2010 Spider-Man v01')).toBe('Spider-Man v01');
  });

  it('strips a YYYYMMDD prefix', () => {
    expect(stripLeadingReleaseDate('19930512 X-Force v1 022')).toBe('X-Force v1 022');
  });

  it('leaves numeric-named series alone', () => {
    expect(stripLeadingReleaseDate('7SEEDS v04')).toBe('7SEEDS v04');
    expect(stripLeadingReleaseDate('20th Century Boys v01')).toBe('20th Century Boys v01');
  });

  it('leaves a bare title alone', () => {
    expect(stripLeadingReleaseDate('Standalone Book')).toBe('Standalone Book');
  });
});
