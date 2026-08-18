import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { selectCoverImage, ImageEntry } from './coverSelection';

describe('selectCoverImage', () => {
  it('returns null for empty array', () => {
    expect(selectCoverImage([])).toBeNull();
  });

  it('returns first entry when no cover file exists', () => {
    const entries: ImageEntry[] = [
      { filename: 'page1.jpg', index: 0 },
      { filename: 'page2.jpg', index: 1 },
      { filename: 'page3.jpg', index: 2 },
    ];
    expect(selectCoverImage(entries)).toEqual(entries[0]);
  });

  it('returns cover.jpg when present', () => {
    const entries: ImageEntry[] = [
      { filename: 'page1.jpg', index: 0 },
      { filename: 'cover.jpg', index: 1 },
      { filename: 'page2.jpg', index: 2 },
    ];
    expect(selectCoverImage(entries)).toEqual(entries[1]);
  });

  it('is case-insensitive for cover basename', () => {
    const entries: ImageEntry[] = [
      { filename: 'page1.jpg', index: 0 },
      { filename: 'Cover.png', index: 1 },
      { filename: 'page2.jpg', index: 2 },
    ];
    expect(selectCoverImage(entries)).toEqual(entries[1]);
  });

  it('handles COVER in all caps', () => {
    const entries: ImageEntry[] = [
      { filename: 'page1.jpg', index: 0 },
      { filename: 'COVER.jxl', index: 1 },
    ];
    expect(selectCoverImage(entries)).toEqual(entries[1]);
  });

  it('handles cover with different extensions', () => {
    const entries: ImageEntry[] = [
      { filename: 'page1.jpg', index: 0 },
      { filename: 'cover.webp', index: 1 },
    ];
    expect(selectCoverImage(entries)).toEqual(entries[1]);
  });

  it('handles paths with directories', () => {
    const entries: ImageEntry[] = [
      { filename: 'dir/page1.jpg', index: 0 },
      { filename: 'dir/cover.jpg', index: 1 },
      { filename: 'dir/page2.jpg', index: 2 },
    ];
    expect(selectCoverImage(entries)).toEqual(entries[1]);
  });

  it('returns first entry if cover is not exactly "cover"', () => {
    const entries: ImageEntry[] = [
      { filename: 'page1.jpg', index: 0 },
      { filename: 'cover_page.jpg', index: 1 },
      { filename: 'frontcover.jpg', index: 2 },
    ];
    expect(selectCoverImage(entries)).toEqual(entries[0]);
  });

  it('returns first cover if multiple covers exist', () => {
    const entries: ImageEntry[] = [
      { filename: 'page1.jpg', index: 0 },
      { filename: 'cover.jpg', index: 1 },
      { filename: 'cover.png', index: 2 },
    ];
    expect(selectCoverImage(entries)).toEqual(entries[1]);
  });
});

describe('selectCoverImage - property tests', () => {
  it('Property 18: Returns cover entry when basename is "cover"', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            filename: fc.string({ minLength: 1, maxLength: 20 }).map(s => `${s}.jpg`),
            index: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        fc.integer({ min: 0, max: 9 }),
        fc.constantFrom('jpg', 'png', 'webp', 'jxl'),
        (entries, coverIndex, ext) => {
          if (coverIndex >= entries.length) return;
          
          // Insert a cover entry at coverIndex
          const modifiedEntries = [...entries];
          modifiedEntries[coverIndex] = {
            filename: `cover.${ext}`,
            index: coverIndex,
          };
          
          const result = selectCoverImage(modifiedEntries);
          expect(result?.filename.toLowerCase()).toContain('cover');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 18: Returns first entry when no cover exists', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            filename: fc.string({ minLength: 1, maxLength: 20 })
              .filter(s => !s.toLowerCase().includes('cover'))
              .map(s => `${s}.jpg`),
            index: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (entries) => {
          const result = selectCoverImage(entries);
          expect(result).toEqual(entries[0]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 18: Case-insensitive cover detection', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            filename: fc.string({ minLength: 1, maxLength: 20 }).map(s => `${s}.jpg`),
            index: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        fc.constantFrom('cover', 'Cover', 'COVER', 'CoVeR'),
        fc.constantFrom('jpg', 'png', 'webp'),
        (entries, coverVariant, ext) => {
          const entriesWithCover = [
            ...entries,
            { filename: `${coverVariant}.${ext}`, index: entries.length },
          ];
          
          const result = selectCoverImage(entriesWithCover);
          expect(result?.filename.toLowerCase()).toContain('cover');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 18: Always returns non-null for non-empty arrays', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            filename: fc.string({ minLength: 1, maxLength: 20 }).map(s => `${s}.jpg`),
            index: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (entries) => {
          const result = selectCoverImage(entries);
          expect(result).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
