import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generateWindowTitle } from './windowTitle';

describe('generateWindowTitle', () => {
  it('includes filename in title', () => {
    const title = generateWindowTitle('comic.cbz');
    expect(title).toBe('comic.cbz - CB8');
  });

  it('extracts basename from Unix path', () => {
    const title = generateWindowTitle('/path/to/comic.cbz');
    expect(title).toBe('comic.cbz - CB8');
  });

  it('extracts basename from Windows path', () => {
    const title = generateWindowTitle('C:\\Users\\comics\\book.cbr');
    expect(title).toBe('book.cbr - CB8');
  });

  it('handles nested directories', () => {
    const title = generateWindowTitle('/home/user/comics/series/volume1/chapter1.cbz');
    expect(title).toBe('chapter1.cbz - CB8');
  });

  it('handles filename without path', () => {
    const title = generateWindowTitle('mycomic.cbz');
    expect(title).toBe('mycomic.cbz - CB8');
  });

  it('handles empty path', () => {
    const title = generateWindowTitle('');
    expect(title).toBe('CB8');
  });

  it('handles filenames with spaces', () => {
    const title = generateWindowTitle('/path/to/My Comic Book.cbz');
    expect(title).toBe('My Comic Book.cbz - CB8');
  });

  it('handles filenames with special characters', () => {
    const title = generateWindowTitle('/path/to/Comic #1 (2024).cbz');
    expect(title).toBe('Comic #1 (2024).cbz - CB8');
  });
});

describe('generateWindowTitle - property tests', () => {
  // Generator for filenames that don't contain path separators or whitespace-only strings
  const filenameArb = fc.string({ minLength: 1, maxLength: 30 })
    .filter(s => !s.includes('/') && !s.includes('\\') && s.trim().length > 0);

  // Generator for directory segments (no path separators)
  const dirArb = fc.string({ minLength: 1, maxLength: 10 })
    .filter(s => !s.includes('/') && !s.includes('\\'));

  it('Property 7: Title always contains the basename', () => {
    fc.assert(
      fc.property(
        fc.array(dirArb, { minLength: 1, maxLength: 5 }),
        filenameArb,
        (pathParts, filename) => {
          const filePath = pathParts.join('/') + '/' + filename;
          const title = generateWindowTitle(filePath);
          
          expect(title).toContain(filename.trim());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7: Title always ends with " - CB8"', () => {
    fc.assert(
      fc.property(
        filenameArb,
        (filePath) => {
          const title = generateWindowTitle(filePath);
          expect(title).toMatch(/ - CB8$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7: Handles Unix-style paths', () => {
    fc.assert(
      fc.property(
        fc.array(dirArb, { minLength: 1, maxLength: 5 }),
        filenameArb,
        (dirs, filename) => {
          const filePath = '/' + dirs.join('/') + '/' + filename;
          const title = generateWindowTitle(filePath);
          
          expect(title).toContain(filename.trim());
          expect(title).not.toContain('/');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7: Handles Windows-style paths', () => {
    fc.assert(
      fc.property(
        fc.array(dirArb, { minLength: 1, maxLength: 5 }),
        filenameArb,
        (dirs, filename) => {
          const filePath = 'C:\\' + dirs.join('\\') + '\\' + filename;
          const title = generateWindowTitle(filePath);
          
          expect(title).toContain(filename.trim());
          expect(title).not.toContain('\\');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7: Handles mixed path separators', () => {
    fc.assert(
      fc.property(
        dirArb,
        dirArb,
        filenameArb,
        (dir1, dir2, filename) => {
          const filePath = `${dir1}/${dir2}\\${filename}`;
          const title = generateWindowTitle(filePath);
          
          expect(title).toContain(filename.trim());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7: Basename extraction is consistent', () => {
    fc.assert(
      fc.property(
        fc.array(dirArb, { minLength: 0, maxLength: 5 }),
        filenameArb,
        (pathParts, filename) => {
          const path1 = pathParts.join('/') + (pathParts.length > 0 ? '/' : '') + filename;
          const path2 = pathParts.join('\\') + (pathParts.length > 0 ? '\\' : '') + filename;
          
          const title1 = generateWindowTitle(path1);
          const title2 = generateWindowTitle(path2);
          
          // Both should produce the same title
          expect(title1).toBe(title2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
