import type { FastifyInstance } from 'fastify';
import * as bcrypt from 'bcryptjs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describePg, freshTestDb } from '../test/pgTestDb';
import type { LibraryDatabase } from '../libraryDatabase';
import { buildServer } from '../webServer/server';

/**
 * Per-user library access (P1-1).
 *
 * Proves the isolation contract end to end: a non-member of a restricted
 * collection cannot list or open its books (the API answers 404, not an empty
 * card), members can, and admins see everything. Runs only when
 * `CB8_TEST_DATABASE_URL` is set.
 */

let db: LibraryDatabase;
let server: FastifyInstance;
let adminCookie: string;
let aCookie: string;
let bCookie: string;

let pubLibraryId: number;
let secretLibraryId: number;
let pubComicId: number;
let secretComicId: number;
let uncollectedComicId: number;

function cookieHeader(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(';')[0]).join('; ');
}

async function signIn(username: string, password: string): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ username, password }),
  });
  expect(res.statusCode).toBe(200);
  return cookieHeader(res.headers['set-cookie']);
}

async function addUser(db: LibraryDatabase, username: string): Promise<{ id: number }> {
  const hash = await bcrypt.hash('pw1234', 4);
  const user = await db.createUser(username, hash, false);
  await db.upsertCredentialAccount(user.id, username, hash);
  return user;
}

function comicRecord(filePath: string, title: string) {
  return {
    filePath,
    title,
    pageCount: 10,
    fileSize: 1,
    coverThumbnail: null,
    tags: [] as string[],
    lastPage: null,
    lastLocation: null,
    lastPercent: null,
    lastRead: null,
    mediaType: 'comic' as const,
  };
}

describePg('per-user library access (P1-1)', () => {
  beforeAll(async () => {
    db = await freshTestDb();
    server = await buildServer(db);
    const adminPassword = (await db.getAppMeta('initial_password'))!;
    adminCookie = await signIn('admin', adminPassword);

    const userA = await addUser(db, 'user_a');
    const userB = await addUser(db, 'user_b');
    aCookie = await signIn('user_a', 'pw1234');
    bCookie = await signIn('user_b', 'pw1234');

    // Two collections: Pub (public) and Secret (restricted to user B).
    const pub = await db.createLibrary('Pub');
    const secret = await db.createLibrary('Secret');
    pubLibraryId = pub.id;
    secretLibraryId = secret.id;

    pubComicId = (await db.addComic(comicRecord('/lib/pub.cbz', 'Public Comic'))).id;
    secretComicId = (await db.addComic(comicRecord('/lib/secret.cbz', 'Secret Comic'))).id;
    uncollectedComicId = (await db.addComic(comicRecord('/lib/loose.cbz', 'Uncollected Comic'))).id;

    await db.addComicsToLibrary(pubLibraryId, [pubComicId]);
    await db.addComicsToLibrary(secretLibraryId, [secretComicId]);
    await db.setLibraryAccess(secretLibraryId, false, [userB.id]);
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  it('a non-member cannot list a restricted library, a member and admin can', async () => {
    const aLibs = await db.getAllLibraries(undefined, (await db.getUserByUsername('user_a'))!.id, false);
    const bLibs = await db.getAllLibraries(undefined, (await db.getUserByUsername('user_b'))!.id, false);
    const adminLibs = await db.getAllLibraries(undefined, null, true);

    expect(aLibs.map((l) => l.id)).toEqual([pubLibraryId]);
    expect(bLibs.map((l) => l.id).sort()).toEqual([pubLibraryId, secretLibraryId].sort());
    expect(adminLibs.map((l) => l.id).sort()).toEqual([pubLibraryId, secretLibraryId].sort());
  });

  it('queryComicsForUser hides restricted books from non-members but not members/admins', async () => {
    const a = (await db.getUserByUsername('user_a'))!;
    const b = (await db.getUserByUsername('user_b'))!;

    const aList = await db.queryComicsForUser(a.id, {});
    expect(aList.records.map((r) => r.id).sort()).toEqual([pubComicId, uncollectedComicId].sort());

    const bList = await db.queryComicsForUser(b.id, {});
    expect(bList.records.map((r) => r.id).sort()).toEqual([pubComicId, secretComicId, uncollectedComicId].sort());

    const adminList = await db.queryComicsForUser(a.id, { admin: true });
    expect(adminList.records.map((r) => r.id).sort()).toEqual([pubComicId, secretComicId, uncollectedComicId].sort());
  });

  it('guests only see public libraries and uncollected comics', async () => {
    const guestList = await db.queryComicsForUser(null, {});
    expect(guestList.records.map((r) => r.id).sort()).toEqual([pubComicId, uncollectedComicId].sort());
    const guestLibs = await db.getAllLibraries(undefined, null, false);
    expect(guestLibs.map((l) => l.id)).toEqual([pubLibraryId]);
  });

  it('queryComicsByLibrary returns nothing from a restricted library for a non-member', async () => {
    const a = (await db.getUserByUsername('user_a'))!;
    const b = (await db.getUserByUsername('user_b'))!;

    const aResult = await db.queryComicsByLibrary(secretLibraryId, {}, a.id, false);
    expect(aResult.records).toHaveLength(0);

    const bResult = await db.queryComicsByLibrary(secretLibraryId, {}, b.id, false);
    expect(bResult.records.map((r) => r.id)).toEqual([secretComicId]);
  });

  it('isComicVisible gates single-comic access', async () => {
    const a = (await db.getUserByUsername('user_a'))!;
    const b = (await db.getUserByUsername('user_b'))!;
    expect(await db.isComicVisible(secretComicId, a.id)).toBe(false);
    expect(await db.isComicVisible(secretComicId, b.id)).toBe(true);
    expect(await db.isComicVisible(pubComicId, a.id)).toBe(true);
    expect(await db.isComicVisible(uncollectedComicId, a.id)).toBe(true);
  });

  it('opening a restricted book is a 404 for a non-member, 200 for a member', async () => {
    const denied = await server.inject({ method: 'GET', url: `/api/comics/${secretComicId}`, headers: { cookie: aCookie } });
    expect(denied.statusCode).toBe(404);

    const allowed = await server.inject({ method: 'GET', url: `/api/comics/${secretComicId}`, headers: { cookie: bCookie } });
    expect(allowed.statusCode).toBe(200);
  });

  it('content routes of a restricted book are 404 for a non-member', async () => {
    const headers = { cookie: aCookie };
    const thumb = await server.inject({ method: 'GET', url: `/api/comics/${secretComicId}/thumbnail`, headers });
    const page = await server.inject({ method: 'GET', url: `/api/comics/${secretComicId}/pages/0`, headers });
    const file = await server.inject({ method: 'GET', url: `/api/comics/${secretComicId}/file`, headers });
    const manifest = await server.inject({ method: 'GET', url: `/api/comics/${secretComicId}/manifest`, headers });
    expect(thumb.statusCode).toBe(404);
    expect(page.statusCode).toBe(404);
    expect(file.statusCode).toBe(404);
    expect(manifest.statusCode).toBe(404);
  });

  it('recently-added shelf respects library visibility (P3-2)', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/recently-added', headers: { cookie: aCookie } });
    expect(res.statusCode).toBe(200);
    const ids = (JSON.parse(String(res.body)) as Array<{ id: number }>).map((r) => r.id);
    expect(ids).not.toContain(secretComicId);
    expect(ids).toContain(pubComicId);
    expect(ids).toContain(uncollectedComicId);
  });

  it('the restricted collection page is a 404 for a non-member, 200 for a member', async () => {
    const denied = await server.inject({ method: 'GET', url: `/api/libraries/${secretLibraryId}/comics`, headers: { cookie: aCookie } });
    expect(denied.statusCode).toBe(404);

    const allowed = await server.inject({ method: 'GET', url: `/api/libraries/${secretLibraryId}/comics`, headers: { cookie: bCookie } });
    expect(allowed.statusCode).toBe(200);
  });

  it('admins can read and set library access', async () => {
    const getRes = await server.inject({ method: 'GET', url: `/api/libraries/${secretLibraryId}/access`, headers: { cookie: adminCookie } });
    expect(getRes.statusCode).toBe(200);
    const access = JSON.parse(String(getRes.body)) as { everyone: boolean; memberIds: number[] };
    expect(access.everyone).toBe(false);
    expect(access.memberIds).toHaveLength(1);

    const a = (await db.getUserByUsername('user_a'))!;
    const putRes = await server.inject({
      method: 'PUT',
      url: `/api/libraries/${secretLibraryId}/access`,
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ everyone: false, memberIds: [a.id] }),
    });
    expect(putRes.statusCode).toBe(200);
    expect(await db.getLibraryMemberIds(secretLibraryId)).toEqual([a.id]);

    // Non-admin membership edits are rejected.
    const denied = await server.inject({
      method: 'PUT',
      url: `/api/libraries/${secretLibraryId}/access`,
      headers: { cookie: aCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ everyone: true, memberIds: [] }),
    });
    expect(denied.statusCode).toBe(403);
  });
});
