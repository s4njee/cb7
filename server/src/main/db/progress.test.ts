import { afterEach, beforeEach, expect, it } from 'vitest';
import { describePg, freshTestDb } from '../test/pgTestDb';
import type { LibraryDatabase } from '../libraryDatabase';

describePg('upsertUserProgress (atomic)', () => {
  let db: LibraryDatabase;
  let userId: number;
  let comicId: number;

  beforeEach(async () => {
    db = await freshTestDb();
    userId = (await db.createUser('reader', 'hash', false)).id;
    comicId = (await db.addComic({
      filePath: '/lib/a.cbz', title: 'A', pageCount: 100, fileSize: 1, coverThumbnail: null,
      tags: [], lastPage: null, lastLocation: null, lastPercent: null, lastRead: null, mediaType: 'comic',
    })).id;
  });
  afterEach(async () => { await db?.close(); });

  it('inserts then updates the same row without a PK conflict (repeated saves)', async () => {
    await db.upsertUserProgress(userId, comicId, { page: 3 });
    await db.upsertUserProgress(userId, comicId, { page: 7 });
    await db.upsertUserProgress(userId, comicId, { page: 10, completed: true });
    const p = await db.getUserProgress(userId, comicId);
    expect(p?.lastPage).toBe(10);
    expect(p?.completed).toBe(true);
  });

  it('only updates provided fields — a later page save preserves EPUB location/percent', async () => {
    await db.upsertUserProgress(userId, comicId, { location: 'epubcfi(/6/4)', percent: 42 });
    await db.upsertUserProgress(userId, comicId, { page: 5 });
    const p = await db.getUserProgress(userId, comicId);
    expect(p?.lastLocation).toBe('epubcfi(/6/4)');
    expect(p?.lastPercent).toBe(42);
    expect(p?.lastPage).toBe(5);
  });

  it('handles two near-simultaneous first-time saves without a duplicate-key error', async () => {
    // The exact regression: concurrent saves on a brand-new (user, comic) row.
    await Promise.all([
      db.upsertUserProgress(userId, comicId, { page: 1 }),
      db.upsertUserProgress(userId, comicId, { page: 2 }),
    ]);
    const p = await db.getUserProgress(userId, comicId);
    expect(p?.lastPage === 1 || p?.lastPage === 2).toBe(true);
  });
});
