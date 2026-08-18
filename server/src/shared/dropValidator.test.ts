import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isComicArchive } from './dropValidator';

describe('isComicArchive', () => {
  it('returns true for cbz files', () => {
    expect(isComicArchive('comic.cbz')).toBe(true);
  });

  it('returns true for cbr files', () => {
    expect(isComicArchive('comic.cbr')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isComicArchive('comic.CBZ')).toBe(true);
    expect(isComicArchive('comic.CBR')).toBe(true);
    expect(isComicArchive('comic.Cbz')).toBe(true);
    expect(isComicArchive('comic.CbR')).toBe(true);
  });

  it('returns false for non-comic files', () => {
    expect(isComicArchive('document.pdf')).toBe(false);
    expect(isComicArchive('image.jpg')).toBe(false);
    expect(isComicArchive('archive.zip')).toBe(false);
    expect(isComicArchive('archive.rar')).toBe(false);
  });

  it('returns false for files without extension', () => {
    expect(isComicArchive('noextension')).toBe(false);
  });

  it('handles files with multiple dots', () => {
    expect(isComicArchive('my.comic.book.cbz')).toBe(true);
    expect(isComicArchive('my.comic.book.pdf')).toBe(false);
  });

  it('handles paths with directories', () => {
    expect(isComicArchive('/path/to/comic.cbz')).toBe(true);
    expect(isComicArchive('C:\\Users\\comics\\book.cbr')).toBe(true);
  });
});

describe('isComicArchive - property tests', () => {
  it('Property 5: Returns true only for cbz and cbr extensions', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom('cbz', 'cbr'),
        (basename, ext) => {
          const filename = `${basename}.${ext}`;
          expect(isComicArchive(filename)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 5: Case-insensitive for valid extensions', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom('cbz', 'cbr'),
        fc.constantFrom('lower', 'upper', 'mixed'),
        (basename, ext, caseType) => {
          let finalExt = ext;
          if (caseType === 'upper') {
            finalExt = ext.toUpperCase();
          } else if (caseType === 'mixed') {
            finalExt = ext.split('').map((c, i) => i % 2 === 0 ? c.toUpperCase() : c).join('');
          }
          const filename = `${basename}.${finalExt}`;
          expect(isComicArchive(filename)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 5: Returns false for non-comic extensions', () => {
    const invalidExtensions = ['zip', 'rar', 'pdf', 'jpg', 'png', 'txt', 'doc', 'exe'];
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom(...invalidExtensions),
        (basename, ext) => {
          const filename = `${basename}.${ext}`;
          expect(isComicArchive(filename)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 5: Handles arbitrary paths with valid extensions', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 5 }),
        fc.constantFrom('cbz', 'cbr'),
        (pathParts, ext) => {
          const filename = pathParts.join('/') + '.' + ext;
          expect(isComicArchive(filename)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 5: Handles filenames with multiple dots', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 5 }),
        fc.constantFrom('cbz', 'cbr'),
        (parts, ext) => {
          const filename = parts.join('.') + '.' + ext;
          expect(isComicArchive(filename)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
