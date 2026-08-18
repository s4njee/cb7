import type { Db } from './pg';
import { toVector } from '../search/embedClient';
import { comicVisibilityCondition } from './libraryAccess';

/**
 * @module
 * DB operations for the ebook search index (`ebook_chunks`). Keyword candidates
 * come from the Postgres FTS (`tsv`); semantic candidates from pgvector cosine
 * distance. The route fuses the two (see searchUtil.rrfFuse).
 */

/** A retrieved chunk, joined to its book title for display. */
export interface ChunkHit {
  id: number;
  comic_id: number;
  title: string;
  chapter: string | null;
  content: string;
}

export async function deleteEbookChunks(db: Db, comicId: number): Promise<void> {
  await db.run('DELETE FROM ebook_chunks WHERE comic_id = ?', [comicId]);
}

/** Wipe the entire ebook index — used by the admin "force reindex" to rebuild
 *  from scratch (e.g. after a chunking change, or to clear partial indexes). */
export async function clearAllEbookChunks(db: Db): Promise<void> {
  await db.run('DELETE FROM ebook_chunks');
}

export async function insertEbookChunk(
  db: Db,
  comicId: number,
  chapter: string | null,
  idx: number,
  content: string,
  embedding: number[],
): Promise<void> {
  await db.run(
    'INSERT INTO ebook_chunks (comic_id, chapter, idx, content, embedding) VALUES (?, ?, ?, ?, ?)',
    [comicId, chapter, idx, content, toVector(embedding)],
  );
}

/** Keyword arm: Postgres full-text search, best matches first. */
export function ftsCandidates(
  db: Db,
  q: string,
  limit: number,
  userId: number | null = null,
  admin = false,
): Promise<ChunkHit[]> {
  const conditions = ["e.tsv @@ plainto_tsquery('english', ?)"];
  const params: unknown[] = [q];
  // Per-user library access (P1-1): search-inside never returns passages from
  // books the user can't open.
  if (admin !== true) {
    const visibility = comicVisibilityCondition(userId);
    conditions.push(visibility.sql);
    params.push(...visibility.params);
  }
  return db.all<ChunkHit>(
    `SELECT e.id, e.comic_id, c.title, e.chapter, e.content
       FROM ebook_chunks e JOIN comics c ON c.id = e.comic_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ts_rank(e.tsv, plainto_tsquery('english', ?)) DESC
      LIMIT ?`,
    [...params, q, limit],
  );
}

/** Semantic arm: nearest chunks by cosine distance over the query embedding. */
export function vectorCandidates(
  db: Db,
  queryVec: number[],
  limit: number,
  userId: number | null = null,
  admin = false,
): Promise<ChunkHit[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (admin !== true) {
    const visibility = comicVisibilityCondition(userId);
    conditions.push(visibility.sql);
    params.push(...visibility.params);
  }
  return db.all<ChunkHit>(
    `SELECT e.id, e.comic_id, c.title, e.chapter, e.content
       FROM ebook_chunks e JOIN comics c ON c.id = e.comic_id
      ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY e.embedding <=> ?::vector
      LIMIT ?`,
    [...params, toVector(queryVec), limit],
  );
}
