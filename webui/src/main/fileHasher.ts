import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type { LibraryDatabase } from './libraryDatabase';
import { createLogger } from './logger';

const log = createLogger('contentHash');

/**
 * @module
 * Content hashing for duplicate detection.
 *
 * Full-file SHA-256 over a stream so memory stays flat for huge archives. The
 * hex digest is stored on the catalog row (`comics.content_hash`) and used to
 * reject exact duplicates — two different paths with the same hash are the same
 * file, so only the first is kept.
 */

/**
 * Hash a file's full contents (SHA-256 hex).
 * @param filePath The file to read.
 * @returns The hex digest.
 */
export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      stream.destroy();
      reject(err);
    });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

/**
 * Backfill `content_hash` for legacy rows that predate hashing (P1-4). Walks
 * `WHERE content_hash IS NULL`, streams SHA-256 per row, and writes the column.
 * Idempotent: a re-run is a no-op once every row is hashed, and unreadable files
 * are skipped + logged so a later re-run can retry them.
 * @param db The library database.
 * @param limit Bound the rows processed in one call. The worker boot call is
 *              unbounded (background); the admin route passes a cap so the HTTP
 *              request returns promptly and reports how many remain.
 * @returns How many rows were hashed and how many are still null afterward.
 */
export async function backfillContentHashes(
  db: LibraryDatabase,
  limit?: number,
): Promise<{ hashed: number; remaining: number }> {
  const rows = await db.pool.query<{ id: number; file_path: string }>(
    `SELECT id, file_path FROM comics WHERE content_hash IS NULL${limit != null ? ` LIMIT ${Math.max(1, Math.floor(limit))}` : ''}`,
  );

  let hashed = 0;
  let skipped = 0;
  for (const row of rows.rows) {
    try {
      const digest = await sha256File(row.file_path);
      await db.pool.query('UPDATE comics SET content_hash = $1 WHERE id = $2', [digest, row.id]);
      hashed++;
    } catch {
      skipped++;
    }
  }

  const remainingRow = await db.pool.query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM comics WHERE content_hash IS NULL',
  );
  if (skipped > 0) log.warn(`content-hash backfill skipped ${skipped} unreadable file(s)`);
  return { hashed, remaining: remainingRow.rows[0]?.cnt ?? 0 };
}
