/** DOM id of the navbar search input, targeted by the global `/` shortcut. */
export const NAVBAR_SEARCH_INPUT_ID = 'navbar-search-input';

export type PaletteGroup = 'Books' | 'Collections' | 'Folders' | 'Tags' | 'Actions';

/** Minimal book shape needed by the palette (structurally satisfied by WebComicRecord). */
export interface PaletteBook {
  id: number;
  title: string;
}

/** Minimal named entity shape (structurally satisfied by Library and Folder). */
export interface PaletteEntity {
  id: number;
  name: string;
}

export interface PaletteAction {
  id: string;
  label: string;
  to: string;
}

/** One row in the flattened palette result list. */
export interface PaletteItem {
  key: string;
  group: PaletteGroup;
  label: string;
  to: string;
  /** Set for book rows so the UI can render a thumbnail. */
  comicId?: number;
}

export interface PaletteSources {
  /** Already filtered server-side by the query; included as-is. */
  books: PaletteBook[];
  collections: PaletteEntity[];
  folders: PaletteEntity[];
  tags: string[];
  actions: PaletteAction[];
}

function matches(label: string, query: string): boolean {
  return label.toLowerCase().includes(query);
}

/**
 * Flattens palette sources into a single ordered result list.
 *
 * With an empty query only the actions are returned. With a non-empty query,
 * books (pre-filtered by the server) are included as-is while collections,
 * folders, tags, and actions are filtered client-side (case-insensitive).
 */
export function buildPaletteResults(query: string, sources: PaletteSources): PaletteItem[] {
  const q = query.trim().toLowerCase();
  const results: PaletteItem[] = [];

  if (q) {
    for (const book of sources.books) {
      results.push({
        key: `book-${book.id}`,
        group: 'Books',
        label: book.title,
        to: `/read/${book.id}`,
        comicId: book.id,
      });
    }
    for (const collection of sources.collections) {
      if (matches(collection.name, q)) {
        results.push({
          key: `collection-${collection.id}`,
          group: 'Collections',
          label: collection.name,
          to: `/library/${collection.id}`,
        });
      }
    }
    for (const folder of sources.folders) {
      if (matches(folder.name, q)) {
        results.push({
          key: `folder-${folder.id}`,
          group: 'Folders',
          label: folder.name,
          to: `/folder/${folder.id}`,
        });
      }
    }
    for (const tag of sources.tags) {
      if (matches(tag, q)) {
        results.push({
          key: `tag-${tag}`,
          group: 'Tags',
          label: tag,
          to: `/tag/${encodeURIComponent(tag)}`,
        });
      }
    }
  }

  for (const action of sources.actions) {
    if (!q || matches(action.label, q)) {
      results.push({
        key: `action-${action.id}`,
        group: 'Actions',
        label: action.label,
        to: action.to,
      });
    }
  }

  return results;
}
