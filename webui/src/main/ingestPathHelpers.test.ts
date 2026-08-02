import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dottedExtensionsForMediaType,
  firstFolderFromRelativeDir,
  relativeDirFromScanRoot,
  seriesNameFromScanRoot,
} from './ingestPathHelpers';

describe('ingestPathHelpers', () => {
  it('finds the relative directory for a file below a scan root', () => {
    const root = path.join(path.sep, 'library');
    const filePath = path.join(root, 'Saga', 'Volume 1', 'page.cbz');
    expect(relativeDirFromScanRoot(root, filePath)).toBe(path.join('Saga', 'Volume 1'));
  });

  it('returns an empty relative directory for files directly under the scan root', () => {
    const root = path.join(path.sep, 'library');
    const filePath = path.join(root, 'book.cbz');
    expect(relativeDirFromScanRoot(root, filePath)).toBe('');
  });

  it('gets the first real folder from a relative path', () => {
    expect(firstFolderFromRelativeDir('Saga/Volume 1')).toBe('Saga');
    expect(firstFolderFromRelativeDir('Saga\\Volume 1')).toBe('Saga');
    expect(firstFolderFromRelativeDir('')).toBeNull();
    expect(firstFolderFromRelativeDir('.')).toBeNull();
    expect(firstFolderFromRelativeDir('..')).toBeNull();
    expect(firstFolderFromRelativeDir('../Outside')).toBeNull();
  });

  it('derives a series name from the first folder below the scan root', () => {
    const root = path.join(path.sep, 'library');
    expect(seriesNameFromScanRoot(root, path.join(root, 'Saga', 'book.cbz'))).toBe('Saga');
    expect(seriesNameFromScanRoot(root, path.join(root, 'book.cbz'))).toBeNull();
  });

  it('returns dotted extension sets for scans', () => {
    expect(dottedExtensionsForMediaType('comic')).toEqual(new Set(['.cbz', '.cbr']));
    expect(dottedExtensionsForMediaType('book')).toEqual(new Set(['.pdf', '.epub', '.mobi']));
  });
});
