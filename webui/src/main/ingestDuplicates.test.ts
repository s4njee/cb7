import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describePg, freshTestDb } from './test/pgTestDb';
import type { LibraryDatabase } from './libraryDatabase';
import { buildServer } from './webServer/server';
import { IngestService } from './ingestService';
import type { MediaRecord } from '../shared/types';

/**
 * @module
 * Duplicate detection (P1-4).
 *
 * Locks in the hash-then-dedupe contract: files are hashed at ingest, a
 * byte-identical copy at another path is rejected before insert, the hash is
 * stored for later short-circuiting, and the admin review query surfaces exact
 * and likely groups. Runs only when `CB8_TEST_DATABASE_URL` is set.
 */

let db: LibraryDatabase;
let server: FastifyInstance;
let cookie: string;

function cookieHeader(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(';')[0]).join('; ');
}

type AddRecord = Omit<MediaRecord, 'id' | 'dateAdded'> & { contentHash?: string | null };

function baseRecord(overrides: Partial<AddRecord> = {}): AddRecord {
  return {
    filePath: overrides.filePath ?? join('/lib', `${overrides.title ?? 'Untitled'}.cbz`),
    title: overrides.title ?? 'Untitled',
    pageCount: overrides.pageCount ?? 10,
    fileSize: overrides.fileSize ?? 1,
    coverThumbnail: overrides.coverThumbnail ?? null,
    tags: overrides.tags ?? [],
    lastPage: overrides.lastPage ?? null,
    lastLocation: overrides.lastLocation ?? null,
    lastPercent: overrides.lastPercent ?? null,
    lastRead: overrides.lastRead ?? null,
    mediaType: overrides.mediaType ?? 'comic',
    contentHash: overrides.contentHash ?? null,
  };
}

describePg('duplicate detection (P1-4)', () => {
  beforeAll(async () => {
    db = await freshTestDb();
    server = await buildServer(db);
    const password = (await db.getAppMeta('initial_password'))!;
    const signIn = await server.inject({
      method: 'POST',
      url: '/api/auth/sign-in/username',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'admin', password }),
    });
    expect(signIn.statusCode).toBe(200);
    cookie = cookieHeader(signIn.headers['set-cookie']);
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  it('addFile hashes on ingest and rejects a byte-identical copy at another path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb8-dup-'));
    try {
      const a = join(dir, 'a.epub');
      const b = join(dir, 'b.epub');
      const content = Buffer.from('not a real epub, but identical bytes');
      await writeFile(a, content);
      await writeFile(b, content);

      const ingest = new IngestService(db);
      const first = await ingest.addFile(a);
      expect(first.added).toBe(true);

      const second = await ingest.addFile(b);
      expect(second.added).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(second.duplicateOfId).toBe(first.comicId);

      // Only one row in the catalog — the duplicate never inserted.
      const rows = await db.pool.query('SELECT count(*)::int AS n FROM comics');
      expect(rows.rows[0].n).toBe(1);

      // The stored hash lets a later lookup short-circuit the same file.
      const row = await db.pool.query<{ content_hash: string }>('SELECT content_hash FROM comics LIMIT 1');
      expect(await db.comicExistsByHash(row.rows[0].content_hash)).toBe(first.comicId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a different-file duplicate is not rejected (hash differs)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb8-dup2-'));
    try {
      const a = join(dir, 'a.epub');
      const b = join(dir, 'b.epub');
      await writeFile(a, 'contents-a');
      await writeFile(b, 'contents-b');

      const ingest = new IngestService(db);
      expect((await ingest.addFile(a)).added).toBe(true);
      const second = await ingest.addFile(b);
      expect(second.added).toBe(true);
      expect(second.duplicate).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('comicExistsByHash returns the first cataloged copy', async () => {
    const rec = await db.addComic(baseRecord({ title: 'Hashed', filePath: '/lib/h.epub', mediaType: 'book', contentHash: 'abc123' }));
    expect(await db.comicExistsByHash('abc123')).toBe(rec.id);
    expect(await db.comicExistsByHash('missing')).toBeNull();
  });

  it('findDuplicateGroups surfaces exact and likely groups', async () => {
    // Exact: two records with the same content hash.
    const e1 = await db.addComic(baseRecord({ title: 'Exact A', contentHash: 'same-hash' }));
    const e2 = await db.addComic(baseRecord({ title: 'Exact B', filePath: '/lib/exact-b.cbz', contentHash: 'same-hash' }));
    // Likely: same series + volume, distinct hashes (not already exact).
    const l1 = await db.addComic(baseRecord({ title: 'Naruto 001', contentHash: 'hash-a' }));
    const l2 = await db.addComic(baseRecord({ title: 'Naruto 001 v2', filePath: '/lib/n2.cbz', contentHash: 'hash-b' }));
    await db.setComicSeries(l1.id, 'Naruto', 1, null);
    await db.setComicSeries(l2.id, 'Naruto', 1, null);

    const groups = await db.findDuplicateGroups();

    const exact = groups.find((g) => g.kind === 'exact' && g.key === 'same-hash');
    expect(exact).toBeDefined();
    expect(exact!.members.map((m) => m.id).sort()).toEqual([e1.id, e2.id].sort());

    const likely = groups.find((g) => g.kind === 'likely' && g.key === 'Naruto #1');
    expect(likely).toBeDefined();
    expect(likely!.members.length).toBe(2);
  });

  it('GET /api/admin/duplicates returns the groups to an admin', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/admin/duplicates', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups.some((g: { kind: string }) => g.kind === 'exact')).toBe(true);
  });
});
