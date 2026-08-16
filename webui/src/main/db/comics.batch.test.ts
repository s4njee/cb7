import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { describePg, freshTestDb } from '../test/pgTestDb';
import { LibraryDatabase } from '../libraryDatabase';
import type { MediaRecord } from '../../shared/types';

let db: LibraryDatabase;

async function addMedia(overrides: Partial<Omit<MediaRecord, 'id' | 'dateAdded'>>): Promise<MediaRecord> {
  return db.addComic({
    filePath: overrides.filePath ?? join('library', `${overrides.title ?? 'Untitled'}.cbz`),
    title: overrides.title ?? 'Untitled',
    pageCount: overrides.pageCount ?? 100,
    fileSize: overrides.fileSize ?? 1024,
    coverThumbnail: overrides.coverThumbnail ?? null,
    tags: overrides.tags ?? [],
    lastPage: overrides.lastPage ?? null,
    lastLocation: overrides.lastLocation ?? null,
    lastPercent: overrides.lastPercent ?? null,
    lastRead: overrides.lastRead ?? null,
    mediaType: overrides.mediaType ?? 'comic',
  });
}

// Runs only when CB8_TEST_DATABASE_URL is set (see src/main/test/pgTestDb.ts).
describePg('comic batch operations (P1-2)', () => {
  beforeEach(async () => {
    db = await freshTestDb();
  });

  afterEach(async () => {
    await db?.close();
  });

  it('queryComicIdsForUser returns all ids with no filters, and filters by ext/mediaType', async () => {
    const a = await addMedia({ filePath: 'C:/library/A.cbz', title: 'A' });
    const b = await addMedia({ filePath: 'C:/library/B.cbz', title: 'B' });
    const c = await addMedia({ filePath: 'C:/library/C.pdf', title: 'C', mediaType: 'book' });

    const all = await db.queryComicIdsForUser(null, { admin: true });
    expect(all.ids.slice().sort((x, y) => x - y)).toEqual([a.id, b.id, c.id].sort((x, y) => x - y));
    expect(all.totalCount).toBe(3);
    expect(all.truncated).toBe(false);

    const cbz = await db.queryComicIdsForUser(null, { admin: true, fileExt: 'cbz' });
    expect(cbz.ids.slice().sort((x, y) => x - y)).toEqual([a.id, b.id].sort((x, y) => x - y));
    expect(cbz.totalCount).toBe(2);
    expect(cbz.truncated).toBe(false);

    const books = await db.queryComicIdsForUser(null, { admin: true, mediaType: 'book' });
    expect(books.ids).toEqual([c.id]);
    expect(books.totalCount).toBe(1);
  });

  it('respects a small cap and reports truncated + the true totalCount', async () => {
    const a = await addMedia({ filePath: 'C:/library/A.cbz', title: 'A' });
    const b = await addMedia({ filePath: 'C:/library/B.cbz', title: 'B' });
    const c = await addMedia({ filePath: 'C:/library/C.cbz', title: 'C' });

    const capped = await db.queryComicIdsForUser(null, { admin: true }, 2);
    expect(capped.ids).toHaveLength(2);
    expect(capped.totalCount).toBe(3);
    expect(capped.truncated).toBe(true);
  });

  it('honors per-user readStatus and favorites', async () => {
    const user = await db.createUser('reader', 'hash', false);
    const naruto = await addMedia({ filePath: 'C:/library/Naruto.cbz', title: 'Naruto' });
    const berserk = await addMedia({ filePath: 'C:/library/Berserk.cbz', title: 'Berserk' });
    await db.upsertUserProgress(user.id, naruto.id, { page: 5 });
    await db.addFavorite(user.id, berserk.id);

    const inProgress = await db.queryComicIdsForUser(user.id, { readStatus: 'in-progress' });
    expect(inProgress.ids).toEqual([naruto.id]);

    const favorites = await db.queryComicIdsForUser(user.id, { favorites: true });
    expect(favorites.ids).toEqual([berserk.id]);
  });

  it('hides restricted-library comics from non-members but not admins (ACL)', async () => {
    const userA = await db.createUser('user_a', 'hash', false);
    const userB = await db.createUser('user_b', 'hash', false);

    const pub = await db.createLibrary('Pub');
    const secret = await db.createLibrary('Secret');
    const pubComic = await addMedia({ filePath: 'C:/library/pub.cbz', title: 'Public' });
    const secretComic = await addMedia({ filePath: 'C:/library/secret.cbz', title: 'Secret' });
    const loose = await addMedia({ filePath: 'C:/library/loose.cbz', title: 'Loose' });

    await db.addComicsToLibrary(pub.id, [pubComic.id]);
    await db.addComicsToLibrary(secret.id, [secretComic.id]);
    await db.setLibraryAccess(secret.id, false, [userB.id]);

    const aIds = await db.queryComicIdsForUser(userA.id, {});
    expect(aIds.ids.slice().sort((x, y) => x - y)).toEqual([pubComic.id, loose.id].sort((x, y) => x - y));
    expect(aIds.totalCount).toBe(2);

    const bIds = await db.queryComicIdsForUser(userB.id, {});
    expect(bIds.ids.slice().sort((x, y) => x - y)).toEqual([pubComic.id, secretComic.id, loose.id].sort((x, y) => x - y));

    const adminIds = await db.queryComicIdsForUser(null, { admin: true });
    expect(adminIds.ids.slice().sort((x, y) => x - y)).toEqual([pubComic.id, secretComic.id, loose.id].sort((x, y) => x - y));
  });

  it('updateComicMetadataBulk updates only provided fields, clears on null, no-ops on empty', async () => {
    const a = await addMedia({ filePath: 'C:/library/A.cbz', title: 'A' });
    const b = await addMedia({ filePath: 'C:/library/B.cbz', title: 'B' });
    await db.setComicSeries(a.id, 'Series', 1, 1);
    await db.setComicSeries(b.id, 'Series', 1, 1);

    await db.updateComicMetadataBulk([a.id, b.id], { author: 'X' });
    const metaA = (await db.getComicMetadata(a.id))!;
    const metaB = (await db.getComicMetadata(b.id))!;
    expect(metaA.author).toBe('X');
    expect(metaA.seriesName).toBe('Series');
    expect(metaA.volumeNumber).toBe(1);
    expect(metaA.summary).toBeNull();
    expect(metaB.author).toBe('X');
    expect(metaB.seriesName).toBe('Series');

    await db.updateComicMetadataBulk([a.id], { author: null });
    expect((await db.getComicMetadata(a.id))!.author).toBeNull();

    // Empty fields = no-op; nothing is clobbered.
    await db.updateComicMetadataBulk([a.id, b.id], {});
    expect((await db.getComicMetadata(a.id))!.author).toBeNull();
    expect((await db.getComicMetadata(a.id))!.seriesName).toBe('Series');
    expect((await db.getComicMetadata(b.id))!.author).toBe('X');
  });

  it('replaceTagsForComics sets, replaces, and clears tags', async () => {
    const a = await addMedia({ filePath: 'C:/library/A.cbz', title: 'A', tags: ['old'] });
    const b = await addMedia({ filePath: 'C:/library/B.cbz', title: 'B' });

    await db.replaceTagsForComics([a.id, b.id], ['shonen', 'action']);
    const shonen = await db.queryComicsForUser(null, { admin: true, tag: 'shonen' });
    expect(shonen.records.map((r) => r.id).sort((x, y) => x - y)).toEqual([a.id, b.id].sort((x, y) => x - y));

    // Second call replaces the set: a's old tags are gone, b keeps its own.
    await db.replaceTagsForComics([a.id], ['seinen']);
    const shonenAfter = await db.queryComicsForUser(null, { admin: true, tag: 'shonen' });
    expect(shonenAfter.records.map((r) => r.id)).toEqual([b.id]);
    const seinen = await db.queryComicsForUser(null, { admin: true, tag: 'seinen' });
    expect(seinen.records.map((r) => r.id)).toEqual([a.id]);

    // Empty array removes all links.
    await db.replaceTagsForComics([a.id], []);
    const seinenAfter = await db.queryComicsForUser(null, { admin: true, tag: 'seinen' });
    expect(seinenAfter.records).toHaveLength(0);
  });
});
