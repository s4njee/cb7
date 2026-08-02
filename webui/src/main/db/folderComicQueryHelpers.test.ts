import { describe, expect, it } from 'vitest';
import { buildFolderComicsWhere } from './folderComicQueryHelpers';

describe('folderComicQueryHelpers', () => {
  it('always scopes comics to the selected folder', () => {
    expect(buildFolderComicsWhere(42, {})).toEqual({
      where: 'WHERE c.id IN (SELECT comic_id FROM folder_comics WHERE folder_id = ?)',
      params: [42],
    });
  });

  it('adds media type, search, and extension filters in binding order', () => {
    expect(buildFolderComicsWhere(7, {
      mediaType: 'book',
      search: 'Saga',
      fileExt: 'EPUB',
    })).toEqual({
      where: [
        'WHERE c.id IN (SELECT comic_id FROM folder_comics WHERE folder_id = ?)',
        'c.media_type = ?',
        '(c.title ILIKE ? OR c.file_path ILIKE ?)',
        'LOWER(c.file_path) LIKE ?',
      ].join(' AND '),
      params: [7, 'book', '%Saga%', '%Saga%', '%.epub'],
    });
  });

  it('adds shared read-status filters', () => {
    expect(buildFolderComicsWhere(3, { readStatus: 'completed' })).toEqual({
      where: [
        'WHERE c.id IN (SELECT comic_id FROM folder_comics WHERE folder_id = ?)',
        'c.last_page = c.page_count - 1',
      ].join(' AND '),
      params: [3],
    });
  });
});
