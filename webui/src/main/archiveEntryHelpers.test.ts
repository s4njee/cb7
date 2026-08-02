import { describe, expect, it } from 'vitest';
import {
  archiveBasename,
  archiveExtension,
  archiveImageEntries,
  isSevenZipDirectory,
  sevenZipImageEntries,
} from './archiveEntryHelpers';

describe('archiveEntryHelpers', () => {
  it('gets archive basenames from slash and backslash paths', () => {
    expect(archiveBasename('Series/Chapter/Page 01.jpg')).toBe('Page 01.jpg');
    expect(archiveBasename('Series\\Chapter\\Page 02.png')).toBe('Page 02.png');
    expect(archiveBasename('cover.webp')).toBe('cover.webp');
  });

  it('gets filename extensions without changing case', () => {
    expect(archiveExtension('/comics/book.CBZ')).toBe('CBZ');
    expect(archiveExtension('README')).toBe('README');
  });

  it('filters to image files and naturally sorts archive entries', () => {
    expect(archiveImageEntries(['page10.jpg', 'notes.txt', 'page2.jpg', 'page1.png'])).toEqual([
      { filename: 'page1.png', index: 0 },
      { filename: 'page2.jpg', index: 1 },
      { filename: 'page10.jpg', index: 2 },
    ]);
  });

  it('recognizes 7-Zip directory records', () => {
    expect(isSevenZipDirectory({ techInfo: new Map([['Folder', '+']]) })).toBe(true);
    expect(isSevenZipDirectory({ techInfo: new Map([['Attributes', 'D_ drwxr-xr-x']]) })).toBe(true);
    expect(isSevenZipDirectory({ techInfo: new Map([['Attributes', 'A_ -rw-r--r--']]) })).toBe(false);
    expect(isSevenZipDirectory({})).toBe(false);
  });

  it('builds image entries from 7-Zip records while skipping directories', () => {
    const records = [
      { file: 'folder', techInfo: new Map([['Folder', '+']]) },
      { file: 'folder/page2.jpg', techInfo: new Map([['Attributes', 'A']]) },
      { file: 'folder/page1.jpg', techInfo: new Map([['Attributes', 'A']]) },
      { file: 'folder/readme.txt', techInfo: new Map([['Attributes', 'A']]) },
    ];

    expect(sevenZipImageEntries(records)).toEqual([
      { filename: 'folder/page1.jpg', index: 0 },
      { filename: 'folder/page2.jpg', index: 1 },
    ]);
  });
});
