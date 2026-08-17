import { NOW_TEXT_SQL, type Db } from './pg';

/** Read a comic's cover from the `comic_covers` table, or null if none. */
export async function getComicCover(db: Db, comicId: number): Promise<Buffer | null> {
  const row = await db.get<{ data: Buffer | null }>('SELECT data FROM comic_covers WHERE comic_id = ?', [comicId]);
  return row?.data ?? null;
}

/** Upsert a comic's cover into `comic_covers` (the P0-3 source of truth). */
export async function setComicCover(db: Db, comicId: number, data: Buffer): Promise<void> {
  await db.run(
    `INSERT INTO comic_covers (comic_id, data) VALUES (?, ?)
     ON CONFLICT (comic_id) DO UPDATE SET data = EXCLUDED.data, updated_at = ${NOW_TEXT_SQL}`,
    [comicId, data],
  );
}

/**
 * Write (or clear) a comic's cover by its file path.
 */
export async function updateCoverThumbnailByPath(db: Db, filePath: string, coverThumbnail: Buffer | null): Promise<void> {
  if (coverThumbnail == null) {
    await db.run('DELETE FROM comic_covers WHERE comic_id = (SELECT id FROM comics WHERE file_path = ?)', [filePath]);
    return;
  }
  await db.run(
    `INSERT INTO comic_covers (comic_id, data)
     SELECT id, ? FROM comics WHERE file_path = ?
     ON CONFLICT (comic_id) DO UPDATE SET data = EXCLUDED.data, updated_at = ${NOW_TEXT_SQL}`,
    [coverThumbnail, filePath],
  );
}

/**
 * One-time migration: copy any remaining legacy `comics.cover_thumbnail` blobs
 * into `comic_covers`.
 */
export async function backfillComicCovers(db: Db): Promise<number> {
  await db.run(
    `INSERT INTO comic_covers (comic_id, data)
     SELECT id, cover_thumbnail FROM comics
     WHERE cover_thumbnail IS NOT NULL
     ON CONFLICT (comic_id) DO NOTHING`,
  );
  const result = await db.run(
    `UPDATE comics SET cover_thumbnail = NULL
     WHERE cover_thumbnail IS NOT NULL
       AND id IN (SELECT comic_id FROM comic_covers)`,
  );
  return result.rowCount;
}
