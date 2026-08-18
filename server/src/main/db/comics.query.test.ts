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
describePg('comic query filters and user overlays', () => {
  beforeEach(async () => {
    db = await freshTestDb();
  });

  afterEach(async () => {
    await db?.close();
  });

  it('filters by extension, tag, sanitized FTS text, read status, and favorites', async () => {
    const user = await db.createUser('reader', 'hash', false);
    const naruto = await addMedia({
      filePath: 'C:/library/Naruto 001.cbz',
      title: 'Naruto 001',
      tags: ['shonen'],
    });
    const guide = await addMedia({
      filePath: 'C:/library/Naruto Guide.pdf',
      title: 'Naruto Guide',
      mediaType: 'book',
      tags: ['guide'],
    });
    const berserk = await addMedia({
      filePath: 'C:/library/Berserk 001.cbr',
      title: 'Berserk 001',
      tags: ['seinen'],
    });
    await addMedia({
      filePath: 'C:/library/Space Novel.epub',
      title: 'Space Novel',
      mediaType: 'book',
      tags: ['sci-fi'],
    });

    await db.upsertUserProgress(user.id, naruto.id, { page: 5 });
    await db.upsertUserProgress(user.id, guide.id, { page: guide.pageCount - 1, completed: true });
    await db.addFavorite(user.id, berserk.id);

    expect((await db.queryComicsForUser(user.id, { fileExt: 'cbz' })).records.map((r) => r.id))
      .toEqual([naruto.id]);
    expect((await db.queryComicsForUser(user.id, { tag: 'shonen' })).records.map((r) => r.id))
      .toEqual([naruto.id]);
    expect((await db.queryComicsForUser(user.id, { search: 'naru-to' })).records.map((r) => r.title))
      .toEqual(['Naruto 001', 'Naruto Guide']);
    expect((await db.queryComicsForUser(user.id, { readStatus: 'in-progress' })).records.map((r) => r.id))
      .toEqual([naruto.id]);
    expect((await db.queryComicsForUser(user.id, { readStatus: 'completed' })).records.map((r) => r.id))
      .toEqual([guide.id]);
    expect((await db.queryComicsForUser(user.id, { favorites: true })).records.map((r) => r.id))
      .toEqual([berserk.id]);

    const bookPdf = (await db.queryComicsForUser(user.id, { mediaType: 'book', fileExt: 'pdf' })).records[0];
    expect(bookPdf.id).toBe(guide.id);
    expect(bookPdf.lastPage).toBe(guide.pageCount - 1);
    expect(bookPdf.favorited).toBe(false);
  });

  it('applies hierarchy filters consistently for global and folder-scoped series groups', async () => {
    const user = await db.createUser('reader', 'hash', false);
    const naruto = await addMedia({
      filePath: 'C:/library/Naruto 001.cbz',
      title: 'Naruto 001',
    });
    const berserk = await addMedia({
      filePath: 'C:/library/Berserk 001.cbr',
      title: 'Berserk 001',
    });
    const guide = await addMedia({
      filePath: 'C:/library/Naruto Guide.pdf',
      title: 'Naruto Guide',
      mediaType: 'book',
    });

    await db.setComicSeries(naruto.id, 'Naruto', 1, 1);
    await db.setComicSeries(berserk.id, 'Berserk', 1, 1);
    await db.setComicSeries(guide.id, 'Naruto', 1, 2);
    const folder = await db.createFolder('Manga', [naruto.id, berserk.id]);

    expect((await db.getGlobalSeriesGroups(user.id, { fileExt: 'pdf' })).map((g) => `${g.name}:${g.count}`))
      .toEqual(['Naruto:1']);
    expect((await db.getFolderSeriesGroups(user.id, folder.id, { fileExt: 'cbr' })).map((g) => `${g.name}:${g.count}`))
      .toEqual(['Berserk:1']);
  });
});
