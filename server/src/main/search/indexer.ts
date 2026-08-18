import type { Db } from '../db/pg';
import { extractEpubText } from './epubText';
import { chunkText } from './searchUtil';
import { embed, isEmbeddingServiceDown } from './embedClient';
import { deleteEbookChunks, insertEbookChunk } from '../db/ebookSearch';

/**
 * @module
 * Indexing orchestration: turn a book's EPUB into searchable, embedded chunks.
 * Called on import and for backfilling existing books.
 */

/** (Re)index one book. Returns the number of chunks stored. Atomic: on any
 * failure it clears partial chunks so the book stays fully un-indexed and the
 * next backfill retries the whole thing (a mid-book embed failure must not leave
 * a half-indexed book that the incremental backfill then skips forever). */
export async function indexBook(db: Db, comicId: number, filePath: string): Promise<number> {
  const { sections } = await extractEpubText(filePath);
  await deleteEbookChunks(db, comicId); // idempotent: replace any prior index
  let idx = 0;
  try {
    for (const sec of sections) {
      const chunks = chunkText(sec.text);
      if (chunks.length === 0) continue;
      const vectors = await embed(chunks);
      for (let i = 0; i < chunks.length; i++) {
        await insertEbookChunk(db, comicId, sec.chapter, idx++, chunks[i], vectors[i]);
      }
    }
  } catch (err) {
    await deleteEbookChunks(db, comicId).catch(() => {});
    throw err;
  }
  return idx;
}

/** Backfill: index every EPUB book that has no chunks yet. */
export async function backfillBooks(db: Db): Promise<{ indexed: number; chunks: number }> {
  const rows = await db.all<{ id: number; file_path: string }>(
    `SELECT c.id, c.file_path FROM comics c
      WHERE c.media_type = 'book' AND lower(c.file_path) LIKE '%.epub'
        AND NOT EXISTS (SELECT 1 FROM ebook_chunks e WHERE e.comic_id = c.id)`,
  );
  let chunks = 0;
  let indexed = 0;
  for (const r of rows) {
    try {
      chunks += await indexBook(db, r.id, r.file_path);
      indexed++;
    } catch (err) {
      // Embedding service down (mars/TEI offline, GPU fault): don't hammer every
      // book or error-storm the logs — bail quietly. The remaining books stay
      // un-indexed and get picked up on the next scan/restart/reindex once it's up.
      if (isEmbeddingServiceDown(err)) {
        console.warn(
          `[search] embedding service unavailable — skipping backfill; ${rows.length - indexed} book(s) left for next run`,
        );
        break;
      }
      console.error(`[search] failed to index comic ${r.id} (${r.file_path}):`, err);
    }
  }
  return { indexed, chunks };
}
