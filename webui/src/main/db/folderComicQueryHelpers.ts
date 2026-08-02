import type { QueryOptions } from '../../shared/types';
import { addSharedReadStatusFilter } from './comicQueryHelpers';
import type { SqlParam } from './types';

/**
 * @module
 * Folder Comic List Query Helpers
 *
 * Architecture overview for Junior Devs:
 * The folder detail view is a normal comic listing with one mandatory filter:
 * every row must belong to the selected folder. Optional filters (media type,
 * search, file extension, read status) are accumulated here so `folders.ts`
 * can focus on executing SQL and mapping rows.
 */

export type FolderComicsWhere = {
  where: string;
  params: SqlParam[];
};

export function buildFolderComicsWhere(folderId: number, options: QueryOptions): FolderComicsWhere {
  const conditions: string[] = ['c.id IN (SELECT comic_id FROM folder_comics WHERE folder_id = ?)'];
  const params: SqlParam[] = [folderId];

  if (options.mediaType) {
    conditions.push('c.media_type = ?');
    params.push(options.mediaType);
  }

  if (options.search) {
    conditions.push('(c.title ILIKE ? OR c.file_path ILIKE ?)');
    const term = `%${options.search}%`;
    params.push(term, term);
  }

  if (options.fileExt) {
    conditions.push('LOWER(c.file_path) LIKE ?');
    params.push('%.' + options.fileExt.toLowerCase());
  }

  addSharedReadStatusFilter(conditions, options.readStatus);

  return {
    where: `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}
