import { join } from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { describePg, freshTestDb } from '../test/pgTestDb';
import { LibraryDatabase } from '../libraryDatabase';
import type { MediaRecord } from '../../shared/types';

/**
 * P1-8: missing-file handling. Locks in mark/clear of `missing_at`, the
 * `missing` list filter, the prune sweep, path relocation, and the post-scan
 * root sweep (marking gone files, clearing returned ones, leaving outsiders).
 *
 * Runs only when CB8_TEST_DATABASE_URL is set (see src/main/test/pgTestDb.ts).
 */
describePg('comic missing-file handling (P1-8)', () => {
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

  async function missingAt(comicId: number): Promise<string | null> {
    const row = await db.pool.query('SELECT missing_at FROM comics WHERE id = $1', [comicId]);
    return row.rows[0]?.missing_at ?? null;
  }

  beforeEach(async () => {
    db = await freshTestDb();
  });

  afterEach(async () => {
    await db?.close();
  });

  it('markComicMissing / clearComicMissing set and clear the column idempotently', async () => {
    const rec = await addMedia({});
    expect(await missingAt(rec.id)).toBeNull();

    await db.markComicMissing(rec.id);
    const stamped = await missingAt(rec.id);
    expect(stamped).not.toBeNull();
    expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/); // NOW_TEXT shape

    // Re-marking an already-missing row is a no-op (still set).
    await db.markComicMissing(rec.id);
    expect(await missingAt(rec.id)).not.toBeNull();

    await db.clearComicMissing(rec.id);
    expect(await missingAt(rec.id)).toBeNull();
    await db.clearComicMissing(rec.id);
    expect(await missingAt(rec.id)).toBeNull();
  });

  it('filters by the missing flag through queryComicsForUser', async () => {
    const present = await addMedia({ filePath: '/lib/present.cbz', title: 'Present' });
    const gone = await addMedia({ filePath: '/lib/gone.cbz', title: 'Gone' });
    await db.markComicMissing(gone.id);

    const missingOnly = await db.queryComicsForUser(null, { missing: true });
    expect(missingOnly.records.map((r) => r.id)).toEqual([gone.id]);
    expect(missingOnly.records[0].missingAt).not.toBeNull();

    const presentOnly = await db.queryComicsForUser(null, { missing: false });
    expect(presentOnly.records.map((r) => r.id)).toEqual([present.id]);
    expect(presentOnly.records[0].missingAt).toBeNull();

    // No flag → everything.
    const all = await db.queryComicsForUser(null, {});
    expect(all.records.map((r) => r.id).sort((a, b) => a - b)).toEqual([present.id, gone.id].sort((a, b) => a - b));
  });

  it('pruneMissingComics removes only missing rows and inserts dismissed_paths for scan-sourced rows', async () => {
    const present = await addMedia({ filePath: '/lib/present.cbz', title: 'Present' });
    const gone = await addMedia({ filePath: '/lib/gone.cbz', title: 'Gone' });
    await db.markComicMissing(gone.id);

    const removed = await db.pruneMissingComics();
    expect(removed).toBe(1);
    expect(await db.getComic(gone.id)).toBeNull();
    expect(await db.getComic(present.id)).not.toBeNull();
    // Scan-sourced row → dismissed so a rescan won't immediately re-add it.
    expect(await db.isDismissed('/lib/gone.cbz')).toBe(true);
    expect(await db.isDismissed('/lib/present.cbz')).toBe(false);
  });

  it('relocateComicPath repoints the row, clears missing_at, and drops the new path dismissal', async () => {
    const rec = await addMedia({ filePath: '/lib/old.cbz', title: 'Moved' });
    await db.markComicMissing(rec.id);
    // Simulate a previous removal that left a dismissal for the new path.
    await db.pool.query('INSERT INTO dismissed_paths (file_path) VALUES ($1)', ['/lib/new.cbz']);

    await db.relocateComicPath(rec.id, '/lib/new.cbz', 'newhash');

    const row = await db.pool.query(
      'SELECT file_path, content_hash, source, missing_at FROM comics WHERE id = $1',
      [rec.id],
    );
    expect(row.rows[0].file_path).toBe('/lib/new.cbz');
    expect(row.rows[0].content_hash).toBe('newhash');
    expect(row.rows[0].source).toBe('scan');
    expect(row.rows[0].missing_at).toBeNull();

    const dismissal = await db.pool.query('SELECT 1 FROM dismissed_paths WHERE file_path = $1', ['/lib/new.cbz']);
    expect(dismissal.rows).toHaveLength(0);
  });

  it('refreshMissingUnderRoot marks gone files, clears returned files, leaves outsiders alone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cb8-missing-'));
    const existsPath = join(root, 'exists.cbz');
    const gonePath = join(root, 'gone.cbz');
    const outsidePath = join(root, '..', 'outside.cbz'); // sibling of root, not under it
    await writeFile(existsPath, 'x');

    const exists = await addMedia({ filePath: existsPath, title: 'Exists' });
    const gone = await addMedia({ filePath: gonePath, title: 'Gone' });
    const outside = await addMedia({ filePath: outsidePath, title: 'Outside' });

    // exists starts missing (file IS there — sweep should clear it); gone starts
    // present (file NOT there — sweep should mark it); outside starts missing but
    // lives outside the root, so the sweep must leave it untouched.
    await db.markComicMissing(exists.id);
    await db.markComicMissing(outside.id);

    const result = await db.refreshMissingUnderRoot(root);
    expect(result.marked).toBe(1);
    expect(result.cleared).toBe(1);
    expect(await missingAt(exists.id)).toBeNull();
    expect(await missingAt(gone.id)).not.toBeNull();
    expect(await missingAt(outside.id)).not.toBeNull();
  });
});
