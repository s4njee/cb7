import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { describePg, freshTestDb } from '../test/pgTestDb';
import type { LibraryDatabase } from '../libraryDatabase';
import { PgDatabase } from './pg';
import { addComicFast, fillNullMetadataFromEmbedded, type AddComicFastMetadata } from './comics';

/**
 * P1-3: embedded metadata at ingest. Locks in the two new ingest paths — the
 * INSERT carrying `language`/`publisher`/etc. columns straight from the file's
 * own metadata, and the fill-only-nulls helper the refresh route uses to backfill
 * a comic from ComicInfo.xml / the EPUB OPF without clobbering user edits.
 *
 * The facade (`db.addComicFast`) keeps its original narrow param type, so the
 * metadata/tags params are exercised through the free function directly (the
 * ingest pipeline calls the free function too).
 *
 * Runs only when CB8_TEST_DATABASE_URL is set (see src/main/test/pgTestDb.ts).
 */
describePg('ingest metadata (P1-3: embedded metadata at ingest)', () => {
  let db: LibraryDatabase;

  const pg = (): PgDatabase => new PgDatabase(db.pool);

  async function addFast(
    overrides: { title?: string; filePath?: string; metadata?: AddComicFastMetadata; tags?: string[] } = {},
  ): Promise<number> {
    return addComicFast(pg(), {
      filePath: overrides.filePath ?? join('library', `${overrides.title ?? 'Untitled'}.cbz`),
      title: overrides.title ?? 'Untitled',
      pageCount: 100,
      fileSize: 1024,
      coverThumbnail: Buffer.from('fake-jpeg-bytes-1'),
      mediaType: 'comic',
      ...(overrides.metadata !== undefined ? { metadata: overrides.metadata } : {}),
      ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
    });
  }

  beforeEach(async () => {
    db = await freshTestDb();
  });
  afterEach(async () => {
    await db?.close();
  });

  it('addComicFast with metadata writes author/genre/year/summary/language/publisher and attaches tags', async () => {
    const id = await addFast({
      title: 'Embedded',
      metadata: { author: 'A', genre: 'Action', year: 2001, summary: 'Sum', language: 'en', publisher: 'Pub' },
      tags: ['action', 'scifi'],
    });
    const meta = await db.getComicMetadata(id);
    expect(meta?.author).toBe('A');
    expect(meta?.genre).toBe('Action');
    expect(meta?.year).toBe(2001);
    expect(meta?.summary).toBe('Sum');
    expect(meta?.language).toBe('en');
    expect(meta?.publisher).toBe('Pub');
    // Series is written separately via setComicSeries — not part of the metadata
    // param, so the insert leaves it null here.
    expect(meta?.seriesName).toBeNull();

    const record = await db.getComic(id);
    expect(record?.tags).toEqual(['action', 'scifi']);
  });

  it('addComicFast without metadata leaves the P1-3 columns null', async () => {
    const id = await addFast({ title: 'Bare' });
    const meta = await db.getComicMetadata(id);
    expect(meta?.author).toBeNull();
    expect(meta?.genre).toBeNull();
    expect(meta?.year).toBeNull();
    expect(meta?.summary).toBeNull();
    expect(meta?.language).toBeNull();
    expect(meta?.publisher).toBeNull();
  });

  it('fillNullMetadataFromEmbedded fills only null columns and reports what changed', async () => {
    const id = await addFast({ title: 'Fill' });
    // Seed author so it should NOT be overwritten by the file's value.
    await db.updateComicMetadata(id, { author: 'Existing' });

    const applied = await fillNullMetadataFromEmbedded(pg(), id, {
      author: 'FromFile',
      seriesName: 'New Series',
      genre: 'Horror',
      tags: ['a', 'b'],
    });

    expect(applied).toEqual({ seriesName: 'New Series', genre: 'Horror', tags: 'a, b' });
    const meta = await db.getComicMetadata(id);
    expect(meta?.author).toBe('Existing'); // untouched
    expect(meta?.seriesName).toBe('New Series');
    expect(meta?.genre).toBe('Horror');

    const record = await db.getComic(id);
    expect(record?.tags).toEqual(['a', 'b']);
  });

  it('fillNullMetadataFromEmbedded does not overwrite existing tags', async () => {
    const id = await addFast({ title: 'Tagged', tags: ['existing'] });

    const applied = await fillNullMetadataFromEmbedded(pg(), id, { tags: ['new1', 'new2'] });

    expect(applied.tags).toBeUndefined();
    const record = await db.getComic(id);
    expect(record?.tags).toEqual(['existing']);
  });

  it('updateComicMetadata writes language and publisher through buildComicMetadataUpdate', async () => {
    const id = await addFast({ title: 'Edit' });
    await db.updateComicMetadata(id, { language: 'fr', publisher: 'ABC' });
    const meta = await db.getComicMetadata(id);
    expect(meta?.language).toBe('fr');
    expect(meta?.publisher).toBe('ABC');
  });
});
