import { describe, expect, it } from 'vitest';
import { buildHierarchyScope } from './folderHierarchyScope';

describe('folderHierarchyScope', () => {
  it('builds an unfiltered global scope', () => {
    expect(buildHierarchyScope(null, {}, null)).toEqual({
      joins: '',
      where: 'WHERE 1=1',
      params: [],
    });
  });

  it('adds folder, media type, extension, and search filters', () => {
    expect(buildHierarchyScope(12, {
      mediaType: 'book',
      fileExt: 'PDF',
      search: 'Saga',
    }, null)).toEqual({
      joins: '',
      where: [
        'WHERE c.id IN (SELECT comic_id FROM folder_comics WHERE folder_id = ?)',
        'AND c.media_type = ?',
        'AND LOWER(c.file_path) LIKE ?',
        'AND (c.title ILIKE ? OR c.file_path ILIKE ? OR c.series_name ILIKE ?)',
      ].join(' '),
      params: [12, 'book', '%.pdf', '%Saga%', '%Saga%', '%Saga%'],
    });
  });

  it('adds shared read-status filters for anonymous/global scopes', () => {
    expect(buildHierarchyScope(null, { readStatus: 'completed' }, null)).toEqual({
      joins: '',
      where: 'WHERE c.last_page = c.page_count - 1',
      params: [],
    });
  });

  it('adds user joins and user read-status filters for user-scoped scopes', () => {
    expect(buildHierarchyScope(null, { readStatus: 'in-progress' }, 7)).toEqual({
      joins: 'LEFT JOIN user_progress up ON up.comic_id = c.id AND up.user_id = ? LEFT JOIN user_favorites uf ON uf.comic_id = c.id AND uf.user_id = ?',
      where: 'WHERE up.comic_id IS NOT NULL AND up.completed = 0 AND (COALESCE(up.last_page, 0) > 0 OR up.last_location IS NOT NULL OR COALESCE(up.last_percent, 0) > 0)',
      params: [7, 7],
    });
  });

  it('requires a user for favorites-only hierarchy filters', () => {
    expect(buildHierarchyScope(null, { favorites: true }, null)).toEqual({
      joins: '',
      where: 'WHERE 1 = 0',
      params: [],
    });

    expect(buildHierarchyScope(null, { favorites: true }, 4)).toEqual({
      joins: 'LEFT JOIN user_progress up ON up.comic_id = c.id AND up.user_id = ? LEFT JOIN user_favorites uf ON uf.comic_id = c.id AND uf.user_id = ?',
      where: 'WHERE uf.comic_id IS NOT NULL',
      params: [4, 4],
    });
  });
});
