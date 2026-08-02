import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  comicThumbnailUrl,
  findCommonDir,
  folderScanMetaKey,
  folderThumbnailUrl,
  parseFolderRouteOptions,
  withGroupThumbnail,
} from './folderRouteHelpers';

describe('folderRouteHelpers', () => {
  it('parses folder route options with defaults and folder scope', () => {
    expect(parseFolderRouteOptions({})).toEqual({ limit: 50 });
    expect(parseFolderRouteOptions({
      limit: '500',
      readStatus: 'in-progress',
      favorites: 'true',
      search: 'saga',
    }, 12)).toEqual({
      limit: 200,
      readStatus: 'in-progress',
      favorites: true,
      search: 'saga',
      folderId: 12,
    });
    expect(parseFolderRouteOptions({ readStatus: 'nope', favorites: 'false' })).toEqual({ limit: 50 });
  });

  it('builds thumbnail URLs for comics and folders', () => {
    expect(comicThumbnailUrl(99)).toBe('/api/comics/99/thumbnail');
    expect(comicThumbnailUrl(null)).toBeNull();
    expect(folderThumbnailUrl(5, true)).toBe('/api/folders/5/thumbnail');
    expect(folderThumbnailUrl(5, false)).toBeNull();
  });

  it('adds hierarchy group thumbnail URLs', () => {
    expect(withGroupThumbnail({ key: 'Saga', coverComicId: 42 })).toEqual({
      key: 'Saga',
      coverComicId: 42,
      thumbnailUrl: '/api/comics/42/thumbnail',
    });
  });

  it('finds the common ancestor directory for folder rescans', () => {
    const root = path.join(path.sep, 'library');
    expect(findCommonDir([
      path.join(root, 'Saga', 'Volume 1'),
      path.join(root, 'Saga', 'Volume 2'),
    ])).toBe(path.join(root, 'Saga'));
    expect(findCommonDir([])).toBeNull();
  });

  it('builds stable folder scan timestamp keys', () => {
    expect(folderScanMetaKey(123)).toBe('folder_scan_ts:123');
  });
});
