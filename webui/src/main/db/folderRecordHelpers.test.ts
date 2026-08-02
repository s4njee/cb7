import { describe, expect, it } from 'vitest';
import {
  initialFolderCoverUpdateId,
  initialFolderCoverId,
  resolveFolderMediaType,
  shouldSetInitialFolderCover,
} from './folderRecordHelpers';

describe('folderRecordHelpers', () => {
  it('classifies folder media type from comic/book counts', () => {
    expect(resolveFolderMediaType(0, 0, 0)).toBe('empty');
    expect(resolveFolderMediaType(3, 3, 0)).toBe('comic');
    expect(resolveFolderMediaType(2, 0, 2)).toBe('book');
    expect(resolveFolderMediaType(5, 3, 2)).toBe('mixed');
    expect(resolveFolderMediaType(1, null, null)).toBe('comic');
  });

  it('uses the first supplied comic as the initial cover', () => {
    expect(initialFolderCoverId([])).toBeNull();
    expect(initialFolderCoverId([42, 99])).toBe(42);
  });

  it('sets a folder cover only when the folder has no cover and new ids exist', () => {
    expect(shouldSetInitialFolderCover(null, [42])).toBe(true);
    expect(shouldSetInitialFolderCover(undefined, [42])).toBe(true);
    expect(shouldSetInitialFolderCover(7, [42])).toBe(false);
    expect(shouldSetInitialFolderCover(null, [])).toBe(false);
  });

  it('returns the initial folder cover update id only when needed', () => {
    expect(initialFolderCoverUpdateId(null, [42, 99])).toBe(42);
    expect(initialFolderCoverUpdateId(undefined, [42])).toBe(42);
    expect(initialFolderCoverUpdateId(7, [42])).toBeNull();
    expect(initialFolderCoverUpdateId(null, [])).toBeNull();
  });
});
