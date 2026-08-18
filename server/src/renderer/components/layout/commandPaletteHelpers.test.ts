import { describe, expect, it } from 'vitest';
import { buildPaletteResults, type PaletteAction, type PaletteSources } from './commandPaletteHelpers';

const actions: PaletteAction[] = [
  { id: 'settings', label: 'Settings', to: '/settings' },
  { id: 'users', label: 'User management', to: '/users' },
];

const sources: PaletteSources = {
  books: [{ id: 7, title: 'Dune' }],
  collections: [{ id: 1, name: 'Sci-fi picks' }],
  folders: [{ id: 2, name: 'Manga' }],
  tags: ['fantasy', 'sci-fi'],
  actions,
};

describe('buildPaletteResults', () => {
  it('shows only actions for an empty or whitespace query', () => {
    for (const query of ['', '   ']) {
      const results = buildPaletteResults(query, sources);
      expect(results.map((r) => r.group)).toEqual(['Actions', 'Actions']);
      expect(results.map((r) => r.label)).toEqual(['Settings', 'User management']);
    }
  });

  it('includes server-filtered books as-is and maps them to reader routes', () => {
    const results = buildPaletteResults('zzz', sources);
    const book = results.find((r) => r.group === 'Books');
    expect(book).toMatchObject({ label: 'Dune', to: '/read/7', comicId: 7 });
  });

  it('filters collections, folders, and tags case-insensitively', () => {
    const results = buildPaletteResults('SCI', { ...sources, books: [] });
    expect(results.map((r) => [r.group, r.to])).toEqual([
      ['Collections', '/library/1'],
      ['Tags', '/tag/sci-fi'],
    ]);
  });

  it('filters actions by the query text', () => {
    const results = buildPaletteResults('user', { ...sources, books: [] });
    const actionRows = results.filter((r) => r.group === 'Actions');
    expect(actionRows.map((r) => r.to)).toEqual(['/users']);
  });

  it('encodes tag names in tag routes', () => {
    const results = buildPaletteResults('slice', { ...sources, books: [], tags: ['slice of life'] });
    expect(results[0].to).toBe('/tag/slice%20of%20life');
  });

  it('orders groups as books, collections, folders, tags, actions', () => {
    const results = buildPaletteResults('a', {
      books: [{ id: 1, title: 'Akira' }],
      collections: [{ id: 1, name: 'All ages' }],
      folders: [{ id: 2, name: 'Manga' }],
      tags: ['fantasy'],
      actions: [{ id: 'users', label: 'User management', to: '/users' }],
    });
    expect(results.map((r) => r.group)).toEqual([
      'Books',
      'Collections',
      'Folders',
      'Tags',
      'Actions',
    ]);
  });

  it('returns an empty list when nothing matches', () => {
    const results = buildPaletteResults('nomatch', { ...sources, books: [] });
    expect(results).toEqual([]);
  });
});
