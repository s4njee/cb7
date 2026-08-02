import type { Db } from './pg';
import { toVector } from '../search/embedClient';

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
export function ftsCandidates(db: Db, q: string, limit: number): Promise<ChunkHit[]> {
  return db.all<ChunkHit>(
    `SELECT e.id, e.comic_id, c.title, e.chapter, e.content
       FROM ebook_chunks e JOIN comics c ON c.id = e.comic_id
      WHERE e.tsv @@ plainto_tsquery('english', ?)
      ORDER BY ts_rank(e.tsv, plainto_tsquery('english', ?)) DESC
      LIMIT ?`,
    [q, q, limit],
  );
}

/** Semantic arm: nearest chunks by cosine distance over the query embedding. */
export function vectorCandidates(db: Db, queryVec: number[], limit: number): Promise<ChunkHit[]> {
  return db.all<ChunkHit>(
    `SELECT e.id, e.comic_id, c.title, e.chapter, e.content
       FROM ebook_chunks e JOIN comics c ON c.id = e.comic_id
      ORDER BY e.embedding <=> ?::vector
      LIMIT ?`,
    [toVector(queryVec), limit],
  );
}
