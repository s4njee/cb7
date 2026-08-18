import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describePg, freshTestDb } from '../../test/pgTestDb';
import type { LibraryDatabase } from '../../libraryDatabase';
import { buildServer } from '../server';
import { GUEST_ACCESS_KEY, invalidateGuestAccessCache } from '../middleware';
import { OPDS_MIME } from './opdsFeedHelpers';

/**
 * @module
 * Route-level tests for the OPDS catalog (`routes/opds.ts`).
 *
 * Drives the real Fastify server over a real Postgres so the auth path (HTTP
 * Basic resolution in `dispatchApi`), the guest gate, the feed wire shapes,
 * and the pagination links are exercised together.
 *
 * Postgres-backed and opt-in: needs `CB8_TEST_DATABASE_URL` (see
 * `test/pgTestDb.ts`), and self-skips without it.
 */

interface OpdsFeedShape {
  metadata: { title: string; numberOfItems?: number; itemsPerPage?: number; currentPage?: number };
  links: Array<{ rel: string; href: string; type?: string; title?: string }>;
  publications?: Array<{ metadata: Record<string, unknown>; links: Array<{ rel: string; href: string; type?: string }> }>;
}

let db: LibraryDatabase;
let server: FastifyInstance;
let admin: { id: number; username: string; password: string };
let cookie: string;

function jsonBody<T>(payload: unknown): T {
  return JSON.parse(String(payload)) as T;
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(';')[0]).join('; ');
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

describePg('OPDS routes', () => {
  beforeAll(async () => {
    db = await freshTestDb();
    server = await buildServer(db);
    const password = (await db.getAppMeta('initial_password'))!;
    expect(password).toBeTruthy();
    const signIn = await server.inject({
      method: 'POST',
      url: '/api/auth/sign-in/username',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'admin', password }),
    });
    expect(signIn.statusCode).toBe(200);
    cookie = cookieHeader(signIn.headers['set-cookie']);
    const user = await db.getUserByUsername('admin');
    admin = { id: user!.id, username: 'admin', password };

    // Two comics: one started (with per-user progress), one untouched.
    const saga = (await db.addComic({
      filePath: '/lib/Saga Vol 1.cbz',
      title: 'Saga Vol 1',
      pageCount: 24,
      fileSize: 1,
      coverThumbnail: null,
      tags: [],
      lastPage: null,
      lastLocation: null,
      lastPercent: null,
      lastRead: null,
      mediaType: 'comic',
    }))!;
    await db.upsertUserProgress(admin.id, saga.id, { page: 8, percent: 34 });
    await db.addComic({
      filePath: '/lib/Berserk Vol 1.cbz',
      title: 'Berserk Vol 1',
      pageCount: 20,
      fileSize: 1,
      coverThumbnail: null,
      tags: [],
      lastPage: null,
      lastLocation: null,
      lastPercent: null,
      lastRead: null,
      mediaType: 'comic',
    });
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  it('root feed advertises navigation subsections and the search endpoint', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/opds', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(OPDS_MIME);
    const feed = jsonBody<OpdsFeedShape>(res.body);
    expect(feed.metadata.title).toBe('CB8');
    const rels = feed.links.map((l) => l.rel);
    expect(rels).toContain('self');
    expect(rels).toContain('subsection');
    expect(rels).toContain('search');
    expect(feed.links.some((l) => l.rel === 'search' && l.href.includes('opensearch.xml'))).toBe(true);
    // The root carries the continue-reading subset, with progress metadata.
    expect(feed.publications?.some((p) => p.metadata.percentRead === 34)).toBe(true);
  });

  it('serves the catalog feed with progress metadata and paging', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/opds/all?limit=1', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const feed = jsonBody<OpdsFeedShape>(res.body);
    expect(feed.metadata.numberOfItems).toBe(2);
    expect(feed.metadata.itemsPerPage).toBe(1);
    expect(feed.metadata.currentPage).toBe(1);
    expect(feed.publications).toHaveLength(1);
    expect(feed.links.some((l) => l.rel === 'next' && l.href.includes('page=2'))).toBe(true);
    const pub = feed.publications![0];
    expect(pub.metadata.identifier).toMatch(/^cb8:comic:\d+$/);
    expect(pub.links.some((l) => l.rel === 'self' && l.href.includes('/manifest'))).toBe(true);
    expect(pub.links.some((l) => l.rel === 'cover' && l.href.includes('/thumbnail'))).toBe(true);
  });

  it('continue feed only lists the in-progress book for the user', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/opds/continue', headers: { cookie } });
    const feed = jsonBody<OpdsFeedShape>(res.body);
    expect(feed.publications?.map((p) => String(p.metadata.title))).toEqual(['Saga Vol 1']);
  });

  it('recent feed is last-read first', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/opds/recent', headers: { cookie } });
    const feed = jsonBody<OpdsFeedShape>(res.body);
    expect(feed.publications?.[0].metadata.title).toBe('Saga Vol 1');
  });

  it('library feed lists only that collection', async () => {
    const sagaId = (await db.queryComicsForUser(admin.id, { search: 'Saga' })).records[0].id;
    await db.createLibrary('Manga', 'comic');
    const library = (await db.getAllLibraries()).find((l) => l.name === 'Manga')!;
    await db.addComicsToLibrary(library.id, [sagaId]);

    const res = await server.inject({ method: 'GET', url: `/api/opds/library/${library.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const feed = jsonBody<OpdsFeedShape>(res.body);
    expect(feed.metadata.title).toBe('Manga');
    expect(feed.publications?.map((p) => String(p.metadata.title))).toEqual(['Saga Vol 1']);
  });

  it('search feed filters by metadata term', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/opds/search?q=Berserk', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const feed = jsonBody<OpdsFeedShape>(res.body);
    expect(feed.publications?.map((p) => String(p.metadata.title))).toEqual(['Berserk Vol 1']);
  });

  it('search requires a query term', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/opds/search', headers: { cookie } });
    expect(res.statusCode).toBe(400);
  });

  it('serves the OpenSearch description as XML', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/opds/search/opensearch.xml', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('opensearchdescription');
    expect(String(res.body)).toContain('<OpenSearchDescription');
    expect(String(res.body)).toContain('?q={searchTerms}');
  });

  it('authenticates via HTTP Basic without a session cookie', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/opds/continue',
      headers: { authorization: basicAuth(admin.username, admin.password) },
    });
    expect(res.statusCode).toBe(200);
    const feed = jsonBody<OpdsFeedShape>(res.body);
    expect(feed.publications?.map((p) => String(p.metadata.title))).toEqual(['Saga Vol 1']);
  });

  it('rejects bad Basic credentials with a WWW-Authenticate challenge', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/opds',
      headers: { authorization: basicAuth(admin.username, 'wrong-password') },
    });
    expect(res.statusCode).toBe(401);
    expect(String(res.headers['www-authenticate'])).toContain('Basic');
  });

  it('rejects anonymous OPDS when guest access is off', async () => {
    // Guests default to read-enabled; flip the flag off for this assertion.
    await db.setAppMeta(GUEST_ACCESS_KEY, 'false');
    invalidateGuestAccessCache(db);
    const res = await server.inject({ method: 'GET', url: '/api/opds/all' });
    expect(res.statusCode).toBe(401);
  });
});
