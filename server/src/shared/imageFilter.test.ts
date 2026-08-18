import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isImageFile } from './imageFilter';

describe('isImageFile', () => {
  it('returns true for jpg files', () => {
    expect(isImageFile('page1.jpg')).toBe(true);
  });

  it('returns true for jpeg files', () => {
    expect(isImageFile('page1.jpeg')).toBe(true);
  });

  it('returns true for png files', () => {
    expect(isImageFile('page1.png')).toBe(true);
  });

  it('returns true for webp files', () => {
    expect(isImageFile('page1.webp')).toBe(true);
  });

  it('returns true for gif files', () => {
    expect(isImageFile('page1.gif')).toBe(true);
  });

  it('returns true for bmp files', () => {
    expect(isImageFile('page1.bmp')).toBe(true);
  });

  it('returns true for jxl files', () => {
    expect(isImageFile('page1.jxl')).toBe(true);
  });

  it('returns true for avif files', () => {
    expect(isImageFile('page1.avif')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isImageFile('page1.JPG')).toBe(true);
    expect(isImageFile('page1.Png')).toBe(true);
    expect(isImageFile('page1.WEBP')).toBe(true);
  });

  it('returns false for non-image files', () => {
    expect(isImageFile('readme.txt')).toBe(false);
    expect(isImageFile('data.json')).toBe(false);
    expect(isImageFile('script.js')).toBe(false);
  });

  it('returns false for files without extension', () => {
    expect(isImageFile('noextension')).toBe(false);
  });

  it('handles files with multiple dots', () => {
    expect(isImageFile('my.file.name.jpg')).toBe(true);
    expect(isImageFile('my.file.name.txt')).toBe(false);
  });
});

describe('isImageFile - property tests', () => {
  const validExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'jxl', 'avif'];

  it('Property 2: Returns true only for recognized image extensions', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom(...validExtensions),
        (basename, ext) => {
          const filename = `${basename}.${ext}`;
          expect(isImageFile(filename)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2: Case-insensitive for valid extensions', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom(...validExtensions),
        fc.constantFrom('lower', 'upper', 'mixed'),
        (basename, ext, caseType) => {
          let finalExt = ext;
          if (caseType === 'upper') {
            finalExt = ext.toUpperCase();
          } else if (caseType === 'mixed') {
            finalExt = ext.split('').map((c, i) => i % 2 === 0 ? c.toUpperCase() : c).join('');
          }
          const filename = `${basename}.${finalExt}`;
          expect(isImageFile(filename)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2: Returns false for non-image extensions', () => {
    const invalidExtensions = ['txt', 'pdf', 'doc', 'mp4', 'zip', 'exe', 'js', 'ts'];
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom(...invalidExtensions),
        (basename, ext) => {
          const filename = `${basename}.${ext}`;
          expect(isImageFile(filename)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2: Handles arbitrary filenames with valid extensions', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 5 }),
        fc.constantFrom(...validExtensions),
        (parts, ext) => {
          const filename = parts.join('.') + '.' + ext;
          expect(isImageFile(filename)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
