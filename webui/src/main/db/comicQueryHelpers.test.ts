import { describe, expect, it } from 'vitest';
import {
  addSharedReadStatusFilter,
  addUserReadStatusFilter,
  buildComicFilters,
  buildFtsQuery,
  buildUserComicOverlaySql,
  buildWhere,
  resolvePaging,
  resolveSort,
  toMediaType,
} from './comicQueryHelpers';

describe('comicQueryHelpers', () => {
  it('builds FTS prefix queries from free-form user text', () => {
    expect(buildFtsQuery('naru-to vol 1')).toBe('naruto:* & vol:* & 1:*');
    expect(buildFtsQuery('  Fullmetal_Alchemist!! 03  ')).toBe('Fullmetal_Alchemist:* & 03:*');
    expect(buildFtsQuery(' -:*() ')).toBeNull();
  });

  it('normalizes database media type values', () => {
    expect(toMediaType('book')).toBe('book');
    expect(toMediaType('comic')).toBe('comic');
    expect(toMediaType('unexpected')).toBe('comic');
  });

  it('builds WHERE clauses only when conditions exist', () => {
    expect(buildWhere([])).toBe('');
    expect(buildWhere(['c.media_type = ?', 'c.file_size > ?'])).toBe('WHERE c.media_type = ? AND c.file_size > ?');
  });

  it('resolves paging defaults and explicit values', () => {
    expect(resolvePaging({})).toEqual({ limit: 50, offset: 0 });
    expect(resolvePaging({ limit: 20, offset: 40 })).toEqual({ limit: 20, offset: 40 });
  });

  it('resolves sort columns for shared and user-scoped queries', () => {
    expect(resolveSort({}, false)).toEqual({ sortCol: 'lower(c.title)', sortDir: 'ASC' });
    expect(resolveSort({ sortBy: 'fileSize', sortOrder: 'desc' }, false)).toEqual({ sortCol: 'c.file_size', sortDir: 'DESC' });
    expect(resolveSort({ sortBy: 'lastRead' }, false)).toEqual({ sortCol: "COALESCE(c.last_read, '')", sortDir: 'ASC' });
    expect(resolveSort({ sortBy: 'lastRead' }, true)).toEqual({ sortCol: "COALESCE(up.last_read, '')", sortDir: 'ASC' });
    expect(resolveSort({ sortBy: 'not-real' as never }, false)).toEqual({ sortCol: 'lower(c.title)', sortDir: 'ASC' });
  });

  it('adds shared read-status predicates', () => {
    const unread: string[] = [];
    addSharedReadStatusFilter(unread, 'unread');
    expect(unread).toEqual(['c.last_page IS NULL AND c.last_read IS NULL']);

    const inProgress: string[] = [];
    addSharedReadStatusFilter(inProgress, 'in-progress');
    expect(inProgress).toEqual(['(c.last_page IS NOT NULL OR c.last_read IS NOT NULL) AND (c.last_page IS NULL OR c.last_page < c.page_count - 1)']);

    const completed: string[] = [];
    addSharedReadStatusFilter(completed, 'completed');
    expect(completed).toEqual(['c.last_page = c.page_count - 1']);

    const unset: string[] = [];
    addSharedReadStatusFilter(unset, undefined);
    expect(unset).toEqual([]);
  });

  it('builds combined comic filters with stable parameter order', () => {
    expect(buildComicFilters({
      libraryId: 7,
      folderId: 11,
      mediaType: 'book',
      search: 'naru-to vol 1',
      tag: 'Favorites',
      excludeFoldered: true,
      fileExt: 'CBZ',
      readStatus: 'completed',
    }, { includeSharedReadStatus: true })).toEqual({
      conditions: [
        'c.id IN (SELECT comic_id FROM library_comics WHERE library_id = ?)',
        'c.id IN (SELECT comic_id FROM folder_comics WHERE folder_id = ?)',
        'c.media_type = ?',
        "c.search_vector @@ to_tsquery('english', ?)",
        'c.id IN (SELECT ct.comic_id FROM comic_tags ct JOIN tags t ON ct.tag_id = t.id WHERE lower(t.name) = lower(?))',
        'c.id NOT IN (SELECT comic_id FROM folder_comics)',
        'LOWER(c.file_path) LIKE ?',
        'c.last_page = c.page_count - 1',
      ],
      params: [7, 11, 'book', 'naruto:* & vol:* & 1:*', 'Favorites', '%.cbz'],
    });
  });

  it('matches nothing when a search filter has no searchable tokens', () => {
    expect(buildComicFilters({ search: ' -:*() ' }, { includeSharedReadStatus: false })).toEqual({
      conditions: ['1 = 0'],
      params: [],
    });
  });

  it('skips shared read-status filters for user-scoped comic queries', () => {
    expect(buildComicFilters({ readStatus: 'unread' }, { includeSharedReadStatus: false })).toEqual({
      conditions: [],
      params: [],
    });
  });

  it('adds user read-status predicates', () => {
    const unread: string[] = [];
    addUserReadStatusFilter(unread, 'unread');
    expect(unread).toEqual(['(up.comic_id IS NULL OR (COALESCE(up.last_page, 0) = 0 AND up.last_location IS NULL AND COALESCE(up.last_percent, 0) = 0 AND up.completed = 0))']);

    const inProgress: string[] = [];
    addUserReadStatusFilter(inProgress, 'in-progress');
    expect(inProgress).toEqual(['up.comic_id IS NOT NULL AND up.completed = 0 AND (COALESCE(up.last_page, 0) > 0 OR up.last_location IS NOT NULL OR COALESCE(up.last_percent, 0) > 0)']);

    const completed: string[] = [];
    addUserReadStatusFilter(completed, 'completed');
    expect(completed).toEqual(['up.completed = 1']);

    const unset: string[] = [];
    addUserReadStatusFilter(unset, undefined);
    expect(unset).toEqual([]);
  });

  it('builds anonymous user overlay SQL placeholders', () => {
    expect(buildUserComicOverlaySql(null)).toEqual({
      progressSelect: 'NULL as up_last_page, NULL as up_last_location, NULL as up_last_percent, NULL as up_last_read, 0 as up_completed',
      favoriteSelect: '0 as is_fav',
      progressJoin: '',
      favoriteJoin: '',
      joinParams: [],
    });
  });

  it('builds user-scoped progress and favorite SQL fragments', () => {
    expect(buildUserComicOverlaySql(42)).toEqual({
      progressSelect: 'up.last_page as up_last_page, up.last_location as up_last_location, up.last_percent as up_last_percent, up.last_read as up_last_read, up.completed as up_completed',
      favoriteSelect: 'CASE WHEN uf.comic_id IS NULL THEN 0 ELSE 1 END as is_fav',
      progressJoin: 'LEFT JOIN user_progress up ON up.comic_id = c.id AND up.user_id = ?',
      favoriteJoin: 'LEFT JOIN user_favorites uf ON uf.comic_id = c.id AND uf.user_id = ?',
      joinParams: [42, 42],
    });
  });
});
