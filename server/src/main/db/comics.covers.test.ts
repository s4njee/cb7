import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { describePg, freshTestDb } from '../test/pgTestDb';
import type { LibraryDatabase } from '../libraryDatabase';

/**
 * P0-3: covers live in `comic_covers`, not on the `comics` row. This suite
 * locks in the write/read/migration paths — ingest writing to the new table,
 * the legacy column staying untouched, the worker backfill moving old blobs and
 * NULLing the column, list queries reporting cover presence from the new table,
 * and folder covers resolving through it.
 *
 * Runs only when CB8_TEST_DATABASE_URL is set (see src/main/test/pgTestDb.ts).
 */
describePg('comic covers (P0-3: off the comics row)', () => {
  let db: LibraryDatabase;

  const cover = (): Buffer => Buffer.from('fake-jpeg-bytes-1');
  const cover2 = (): Buffer => Buffer.from('fake-jpeg-bytes-2');

  async function addComic(
    overrides: { filePath?: string; title?: string; coverThumbnail?: Buffer | null } = {},
  ): Promise<number> {
    const rec = await db.addComic({
      filePath: overrides.filePath ?? join('library', `${overrides.title ?? 'Untitled'}.cbz`),
      title: overrides.title ?? 'Untitled',
      pageCount: 100,
      fileSize: 1024,
      coverThumbnail: overrides.coverThumbnail ?? null,
      tags: [],
      lastPage: null,
      lastLocation: null,
      lastPercent: null,
      lastRead: null,
      mediaType: 'comic',
    });
    return rec.id;
  }

  beforeEach(async () => {
    db = await freshTestDb();
  });
  afterEach(async () => {
    await db?.close();
  });

  it('stores covers in comic_covers, never the legacy comics.cover_thumbnail column', async () => {
    const id = await addComic({ coverThumbnail: cover() });
    expect(await db.getComicCover(id)).toEqual(cover());
    const row = await db.pool.query('SELECT cover_thumbnail FROM comics WHERE id = $1', [id]);
    expect(row.rows[0].cover_thumbnail).toBeNull();
  });

  it('a coverless add leaves no comic_covers row and lists has_thumbnail=0', async () => {
    const id = await addComic(); // no cover
    expect(await db.getComicCover(id)).toBeNull();
    const { records } = await db.queryComicsForUser(null, {});
    const record = records.find((r) => r.id === id);
    expect(record?.hasThumbnail).toBe(false);
    expect(record?.thumbnailVersion).toBe(0);
  });

  it('setComicCover upserts in place (one row per comic)', async () => {
    const id = await addComic({ coverThumbnail: cover() });
    await db.setComicCover(id, cover2());
    expect(await db.getComicCover(id)).toEqual(cover2());
    const rows = await db.pool.query('SELECT count(*)::int as n FROM comic_covers WHERE comic_id = $1', [id]);
    expect(rows.rows[0].n).toBe(1);
  });

  it('addComicFast routes the cover to comic_covers', async () => {
    const id = await db.addComicFast({
      filePath: join('library', 'Fast.cbz'),
      title: 'Fast',
      pageCount: 10,
      fileSize: 5,
      coverThumbnail: cover(),
      mediaType: 'comic',
    });
    expect(await db.getComicCover(id)).toEqual(cover());
    const row = await db.pool.query('SELECT cover_thumbnail FROM comics WHERE id = $1', [id]);
    expect(row.rows[0].cover_thumbnail).toBeNull();
  });

  it('updateCoverThumbnailByPath writes by path and clears the covers row on null', async () => {
    const filePath = join('library', 'X.cbz');
    const id = await addComic({ filePath });
    await db.updateCoverThumbnailByPath(filePath, cover());
    expect(await db.getComicCover(id)).toEqual(cover());
    await db.updateCoverThumbnailByPath(filePath, null);
    expect(await db.getComicCover(id)).toBeNull();
  });

  it('backfillComicCovers migrates legacy blobs, NULLs the column, and is idempotent', async () => {
    const id = await addComic(); // no comic_covers row yet
    // Simulate a pre-P0-3 row: the blob lives on the legacy column only.
    await db.pool.query('UPDATE comics SET cover_thumbnail = $1 WHERE id = $2', [cover(), id]);
    expect(await db.getComicCover(id)).toBeNull();

    const moved = await db.backfillComicCovers();
    expect(moved).toBeGreaterThan(0);
    expect(await db.getComicCover(id)).toEqual(cover());
    const row = await db.pool.query('SELECT cover_thumbnail FROM comics WHERE id = $1', [id]);
    expect(row.rows[0].cover_thumbnail).toBeNull();

    // Idempotent: nothing left to move on a second run.
    expect(await db.backfillComicCovers()).toBe(0);
  });

  it('list queries report has_thumbnail/thumbnail_version from comic_covers', async () => {
    const withCover = await addComic({ title: 'With', coverThumbnail: cover() });
    await addComic({ title: 'Without' });
    const { records } = await db.queryComicsForUser(null, {});
    const covered = records.find((r) => r.id === withCover)!;
    expect(covered.hasThumbnail).toBe(true);
    expect(covered.thumbnailVersion).toBe(cover().length);
    const bare = records.find((r) => r.title === 'Without')!;
    expect(bare.hasThumbnail).toBe(false);
    expect(bare.thumbnailVersion).toBe(0);
  });

  it('folder thumbnails resolve through comic_covers', async () => {
    const id = await addComic({ coverThumbnail: cover() });
    const folder = await db.createFolder('F', [id]);
    expect(await db.getFolderThumbnail(folder.id)).toEqual(cover());
  });

  it('removing a comic cascades its comic_covers row', async () => {
    const id = await addComic({ coverThumbnail: cover() });
    await db.removeComics([id]);
    expect(await db.getComicCover(id)).toBeNull();
    const rows = await db.pool.query('SELECT count(*)::int as n FROM comic_covers WHERE comic_id = $1', [id]);
    expect(rows.rows[0].n).toBe(0);
  });
});
