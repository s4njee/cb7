import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { describePg, freshTestDb } from '../test/pgTestDb';
import { computeStreakFromDays } from './history';
import type { LibraryDatabase } from '../libraryDatabase';

// ---------------------------------------------------------------------------
// Pure streak logic (runs with plain `pnpm test`, no DB).
// ---------------------------------------------------------------------------
describe('computeStreakFromDays (P1-7)', () => {
  it('returns 0 for no reading days', () => {
    expect(computeStreakFromDays([], '2026-08-14')).toBe(0);
  });

  it('counts consecutive days back from today', () => {
    const days = ['2026-08-14', '2026-08-13', '2026-08-12'];
    expect(computeStreakFromDays(days, '2026-08-14')).toBe(3);
  });

  it('counts from yesterday when the user has not read today yet', () => {
    const days = ['2026-08-13', '2026-08-12'];
    expect(computeStreakFromDays(days, '2026-08-14')).toBe(2);
  });

  it('returns 0 when the most recent reading day is older than yesterday', () => {
    const days = ['2026-08-11', '2026-08-10'];
    expect(computeStreakFromDays(days, '2026-08-14')).toBe(0);
  });

  it('resets across a gap', () => {
    const days = ['2026-08-14', '2026-08-12', '2026-08-11'];
    expect(computeStreakFromDays(days, '2026-08-14')).toBe(1);
  });

  it('counts yesterday as part of the streak while today is still open', () => {
    expect(computeStreakFromDays(['2026-08-14', '2026-08-13'], '2026-08-15')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getReadingStats against real Postgres (opt-in, like the other pg suites).
// ---------------------------------------------------------------------------
describePg('getReadingStats (P1-7)', () => {
  let db: LibraryDatabase;

  beforeEach(async () => {
    db = await freshTestDb();
  });

  afterEach(async () => {
    await db?.close();
  });

  async function addComic(title: string, author: string | null, series: string | null): Promise<number> {
    const rec = await db.addComic({
      filePath: join('library', `${title}.cbz`),
      title,
      pageCount: 100,
      fileSize: 1024,
      coverThumbnail: null,
      tags: [],
      lastPage: null,
      lastLocation: null,
      lastPercent: null,
      lastRead: null,
      mediaType: 'comic',
    });
    await db.updateComicMetadata(rec.id, { author, seriesName: series });
    return rec.id;
  }

  /** Insert a reading-history row at a relative day offset (0 = today). */
  async function logOn(
    userId: number,
    comicId: number,
    action: string,
    page: number | null,
    daysAgo: number,
  ): Promise<void> {
    await db.pool.query(
      `INSERT INTO reading_history (user_id, comic_id, action, page, timestamp)
       VALUES ($1, $2, $3, $4, to_char((now() AT TIME ZONE 'UTC') - ($5 || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS'))`,
      [userId, comicId, action, page, daysAgo],
    );
  }

  it('aggregates pages, sessions, and a 2-day streak from a 2-day read of 3 books', async () => {
    const user = await db.createUser('reader', 'hash', false);
    const a = await addComic('Alpha', 'Jane Writer', 'Alpha Series');
    const b = await addComic('Beta', 'Jane Writer', 'Alpha Series');
    const c = await addComic('Gamma', 'Bob Penciller', 'Gamma Series');

    // Acceptance shape: read 3 books across 2 days.
    await logOn(user.id, a, 'opened', 0, 1); // yesterday
    await logOn(user.id, a, 'closed', 30, 1);
    await logOn(user.id, b, 'opened', 0, 0); // today
    await logOn(user.id, b, 'closed', 20, 0);
    await logOn(user.id, c, 'opened', 5, 0);
    await logOn(user.id, c, 'closed', 15, 0);

    const stats = await db.getReadingStats(user.id);
    expect(stats.pages.week).toBe(60); // 30 + 20 + 10
    expect(stats.sessions.week).toBe(3); // a(yesterday), b(today), c(today)
    expect(stats.streak).toBe(2); // today + yesterday
    expect(stats.topAuthors[0]).toEqual({ name: 'Jane Writer', count: 2 });
    expect(stats.topSeries[0]).toEqual({ name: 'Alpha Series', count: 2 });
  });

  it('is scoped per user and reports zero for a user with no history', async () => {
    const reader = await db.createUser('reader', 'hash', false);
    const other = await db.createUser('other', 'hash', false);
    const comic = await addComic('Solo', 'Solo Author', 'Solo Series');

    await logOn(other.id, comic, 'opened', 0, 0);
    await logOn(other.id, comic, 'closed', 10, 0);

    const forReader = await db.getReadingStats(reader.id);
    expect(forReader.pages.week).toBe(0);
    expect(forReader.sessions.week).toBe(0);
    expect(forReader.streak).toBe(0);
    expect(forReader.topAuthors).toEqual([]);
    expect(forReader.topSeries).toEqual([]);

    const forOther = await db.getReadingStats(other.id);
    expect(forOther.pages.week).toBe(10); // span: opened 0 → closed 10
    expect(forOther.sessions.week).toBe(1);
    expect(forOther.streak).toBe(1);
  });

  it('treats null-page (EPUB) logs as one page each', async () => {
    const user = await db.createUser('reader', 'hash', false);
    const comic = await addComic('Epub-Like', 'E Author', null);
    await logOn(user.id, comic, 'opened', null, 0);
    await logOn(user.id, comic, 'closed', null, 0);

    const stats = await db.getReadingStats(user.id);
    expect(stats.pages.week).toBe(1);
    expect(stats.sessions.week).toBe(1);
    expect(stats.streak).toBe(1);
  });
});
