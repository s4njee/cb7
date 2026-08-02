import pg from 'pg';
import { EMBED_DIM } from './embed.mjs';

export { EMBED_DIM };

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://cb8:cb8@localhost:5433/cb8',
});

/**
 * One table holds every chunk: its source book/chapter, the raw text (with a
 * generated `tsvector` for keyword search) and its embedding (for semantic
 * search). Two indexes — GIN for full-text, HNSW for vector cosine — back the
 * two halves of the hybrid query. The vector dimension follows EMBED_DIM, so it
 * tracks whatever embedding model is configured.
 */
export async function ensureSchema() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ebook_chunks (
      id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      book      text NOT NULL,
      chapter   text,
      idx       int  NOT NULL,
      content   text NOT NULL,
      tsv       tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      embedding vector(${EMBED_DIM})
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebook_chunks_tsv ON ebook_chunks USING gin (tsv)');
  await pool.query(
    'CREATE INDEX IF NOT EXISTS ebook_chunks_vec ON ebook_chunks USING hnsw (embedding vector_cosine_ops)'
  );
}

/** pgvector accepts the text form `[1,2,3]`. */
export const toVector = (arr) => `[${arr.join(',')}]`;
