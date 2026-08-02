import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describePg, freshTestDb } from '../../test/pgTestDb';
import type { LibraryDatabase } from '../../libraryDatabase';
import type { BookmarkResponse } from '../../../shared/apiTypes';
import { buildServer } from '../server';

/**
 * @module
 * Route-level tests for the bookmarks endpoints in `routes/progress.ts`.
 *
 * Architecture overview for Junior Devs:
 * A bookmark anchors to exactly one spot: a `page` index for fixed-layout media
 * (comics/PDFs) or a `location` EPUB CFI for reflowable books. That either/or is
 * the whole contract, so these tests drive the real Fastify server over a real
 * Postgres rather than unit-testing the handler — the validation, the DAO's
 * NULL handling, and the wire shape only mean anything together.
 *
 * Postgres-backed and opt-in: needs `CB8_TEST_DATABASE_URL` (see `test/pgTestDb.ts`),
 * and self-skips without it.
 *
 * KNOWN FLAKE — RUN THE PG SUITES SERIALLY:
 *   CB8_TEST_DATABASE_URL=... pnpm test --no-file-parallelism
 * `freshTestDb()` TRUNCATEs a single *shared* database, and vitest runs test
 * files in parallel by default, so any two Pg suites can wipe each other's rows
 * mid-test. This is pre-existing (it already affects `db/progress.test.ts` and
 * `db/comics.query.test.ts`), not specific to this file. Serially, all Pg suites
 * pass; in parallel, failures here are the shared-DB race, not the bookmarks code.
 */

let db: LibraryDatabase;
let server: FastifyInstance;
let comicId: number;
let cookie: string;

function jsonBody<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

/** Collapse better-auth's Set-Cookie into a request-ready Cookie header. */
function cookieHeader(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(';')[0]).join('; ');
}

const PAGE_COUNT = 10;
const CFI = 'epubcfi(/6/14!/4/2/2[c01]/2/1:0)';

describePg('bookmark routes (page-or-location)', () => {
  beforeAll(async () => {
    db = await freshTestDb();
    // buildServer runs ensureInitialAdmin, which seeds `admin` + the generated
    // password in app_meta — so it must come after freshTestDb()'s TRUNCATE.
    server = await buildServer(db);
    const password = await db.getAppMeta('initial_password');
    expect(password).toBeTruthy();
    const signIn = await server.inject({
      method: 'POST',
      url: '/api/auth/sign-in/username',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'admin', password }),
    });
    expect(signIn.statusCode).toBe(200);
    cookie = cookieHeader(signIn.headers['set-cookie']);
    expect(cookie).not.toBe('');
    comicId = (await db.addComic({
      filePath: '/lib/bookmarks.epub',
      title: 'Bookmarks Fixture',
      pageCount: PAGE_COUNT,
      fileSize: 1,
      coverThumbnail: null,
      tags: [],
      lastPage: null,
      lastLocation: null,
      lastPercent: null,
      lastRead: null,
      mediaType: 'book',
    })).id;
  });

  afterAll(async () => {
    await server?.close();
    await db?.close();
  });

  const post = (payload: unknown) => server.inject({
    method: 'POST',
    url: `/api/comics/${comicId}/bookmarks`,
    headers: { 'content-type': 'application/json', cookie },
    payload: JSON.stringify(payload),
  });

  const list = async (): Promise<BookmarkResponse[]> => jsonBody<BookmarkResponse[]>(
    (await server.inject({
      method: 'GET',
      url: `/api/comics/${comicId}/bookmarks`,
      headers: { cookie },
    })).payload,
  );

  it('creates a page-anchored bookmark: page set, location null', async () => {
    const res = await post({ page: 3, note: 'page three' });
    expect(res.statusCode).toBe(201);
    const bookmark = jsonBody<BookmarkResponse>(res.payload);
    expect(bookmark.page).toBe(3);
    expect(bookmark.location).toBeNull();
    expect(bookmark.note).toBe('page three');
  });

  it('creates a CFI-anchored bookmark: page null, location set', async () => {
    const res = await post({ location: CFI, note: 'chapter one' });
    expect(res.statusCode).toBe(201);
    const bookmark = jsonBody<BookmarkResponse>(res.payload);
    expect(bookmark.page).toBeNull();
    expect(bookmark.location).toBe(CFI);
    expect(bookmark.note).toBe('chapter one');
  });

  it('rejects a body with neither page nor location', async () => {
    const res = await post({ note: 'anchored to nothing' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a body with both page and location (ambiguous anchor)', async () => {
    const res = await post({ page: 1, location: CFI });
    expect(res.statusCode).toBe(400);
  });

  it('validates location: non-empty string, max 512 chars', async () => {
    expect((await post({ location: '' })).statusCode).toBe(400);
    expect((await post({ location: '   ' })).statusCode).toBe(400);
    expect((await post({ location: 'x'.repeat(513) })).statusCode).toBe(400);
    expect((await post({ location: 42 })).statusCode).toBe(400);
    // 512 exactly is the boundary and must be accepted.
    expect((await post({ location: 'x'.repeat(512) })).statusCode).toBe(201);
  });

  it('still enforces page validation (integer, >= 0, < pageCount)', async () => {
    expect((await post({ page: PAGE_COUNT })).statusCode).toBe(400);
    expect((await post({ page: 1.5 })).statusCode).toBe(400);
    expect((await post({ page: -1 })).statusCode).toBe(400);
  });

  it('lists page-anchored first in page order, then CFI-anchored, tie-broken by id', async () => {
    const bookmarks = await list();
    const pages = bookmarks.map((b) => b.page);

    // Every page-anchored bookmark precedes every CFI-anchored one (NULLS LAST).
    const firstNull = pages.indexOf(null);
    if (firstNull !== -1) {
      expect(pages.slice(firstNull).every((p) => p === null)).toBe(true);
    }

    // Page-anchored run is ascending by page.
    const anchored = pages.filter((p): p is number => p !== null);
    expect(anchored).toEqual([...anchored].sort((a, b) => a - b));

    // CFI-anchored run is ascending by id, so the order is total and stable.
    const cfiIds = bookmarks.filter((b) => b.page === null).map((b) => b.id);
    expect(cfiIds).toEqual([...cfiIds].sort((a, b) => a - b));

    // Both anchor kinds are actually present, or the assertions above are vacuous.
    expect(anchored.length).toBeGreaterThan(0);
    expect(cfiIds.length).toBeGreaterThan(0);
  });

  it('PUT updates only the note and never clobbers the anchor', async () => {
    const target = (await list()).find((b) => b.location !== null)!;
    expect(target).toBeDefined();
    const res = await server.inject({
      method: 'PUT',
      url: `/api/comics/${comicId}/bookmarks/${target.id}`,
      headers: { 'content-type': 'application/json', cookie },
      payload: JSON.stringify({ note: 'updated note' }),
    });
    expect(res.statusCode).toBe(200);
    const after = (await list()).find((b) => b.id === target.id)!;
    expect(after.note).toBe('updated note');
    expect(after.location).toBe(target.location);
    expect(after.page).toBe(target.page);
  });

  it('requires authentication', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/comics/${comicId}/bookmarks`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ page: 1 }),
    });
    expect(res.statusCode).toBe(401);
  });
});
