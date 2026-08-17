import type { Db } from './pg';
import type { TagIdRow, TagNameRow } from './types';

/**
 * @module
 * Database Operations for Tags
 *
 * Architecture overview for Junior Devs:
 * Owns the `tags` and `comic_tags` tables. Tag names are unique case-insensitively
 * (enforced by a `lower(name)` unique index); attaching a tag inserts it if needed
 * (`ON CONFLICT DO NOTHING`) and links it via the `comic_tags` join table. Free
 * functions taking the async DB handle, surfaced through `libraryDatabase.ts`.
 */

export async function addTag(db: Db, comicId: number, tag: string): Promise<void> {
  await db.run('INSERT INTO tags (name) VALUES (?) ON CONFLICT (lower(name)) DO NOTHING', [tag]);
  const tagRow = await db.get<TagIdRow>('SELECT id FROM tags WHERE lower(name) = lower(?)', [tag]);
  if (!tagRow) return;
  await db.run('INSERT INTO comic_tags (comic_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [comicId, tagRow.id]);
}

export async function removeTag(db: Db, comicId: number, tag: string): Promise<void> {
  const tagRow = await db.get<TagIdRow>('SELECT id FROM tags WHERE lower(name) = lower(?)', [tag]);
  if (!tagRow) return;
  await db.run('DELETE FROM comic_tags WHERE comic_id = ? AND tag_id = ?', [comicId, tagRow.id]);
}

export async function getAllTags(db: Db): Promise<string[]> {
  const rows = await db.all<TagNameRow>('SELECT name FROM tags ORDER BY lower(name)');
  return rows.map((r) => r.name);
}

export async function renameTag(db: Db, oldName: string, newName: string): Promise<void> {
  await db.run('UPDATE tags SET name = ? WHERE lower(name) = lower(?)', [newName, oldName]);
}

export async function deleteTag(db: Db, tag: string): Promise<void> {
  const tagRow = await db.get<TagIdRow>('SELECT id FROM tags WHERE lower(name) = lower(?)', [tag]);
  if (!tagRow) return;
  await db.run('DELETE FROM comic_tags WHERE tag_id = ?', [tagRow.id]);
  await db.run('DELETE FROM tags WHERE id = ?', [tagRow.id]);
}

export async function addTagBulk(db: Db, comicIds: number[], tag: string): Promise<void> {
  await db.run('INSERT INTO tags (name) VALUES (?) ON CONFLICT (lower(name)) DO NOTHING', [tag]);
  const tagRow = await db.get<TagIdRow>('SELECT id FROM tags WHERE lower(name) = lower(?)', [tag]);
  if (!tagRow) return;
  for (const id of comicIds) {
    await db.run('INSERT INTO comic_tags (comic_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [id, tagRow.id]);
  }
}

export async function removeTagBulk(db: Db, comicIds: number[], tag: string): Promise<void> {
  const tagRow = await db.get<TagIdRow>('SELECT id FROM tags WHERE lower(name) = lower(?)', [tag]);
  if (!tagRow) return;
  for (const id of comicIds) {
    await db.run('DELETE FROM comic_tags WHERE comic_id = ? AND tag_id = ?', [id, tagRow.id]);
  }
}

/**
 * Replace the full tag set on many comics at once: delete every existing link for
 * those ids, then attach each tag (reusing the `addTagBulk` insert-if-missing
 * pattern). An empty `tags` array removes all links only. No-op for an empty
 * `comicIds` list.
 * @param db The database handle.
 * @param comicIds Comic ids whose tags should be replaced.
 * @param tags The complete new tag set to attach to every id.
 */
export async function replaceTagsForComics(db: Db, comicIds: number[], tags: string[]): Promise<void> {
  if (comicIds.length === 0) return;
  const placeholders = comicIds.map(() => '?').join(',');
  await db.run(`DELETE FROM comic_tags WHERE comic_id IN (${placeholders})`, comicIds);
  for (const tag of tags) {
    await addTagBulk(db, comicIds, tag);
  }
}
