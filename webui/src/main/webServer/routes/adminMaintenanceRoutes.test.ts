import type { FastifyInstance } from 'fastify';
import * as bcrypt from 'bcryptjs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describePg, freshTestDb } from '../../test/pgTestDb';
import type { LibraryDatabase } from '../../libraryDatabase';
import { buildServer } from '../server';

/**
 * Route-level tests for the P2 maintenance endpoints: server version, cache
 * controls, and admin gating on them. The backup route streams `pg_dump` from
 * the host, so it is intentionally not exercised here (args are unit-tested).
 */

let db: LibraryDatabase;
let server: FastifyInstance;
let adminCookie: string;
let readerCookie: string;

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

describePg('maintenance routes (P2: version / cache)', () => {
  beforeAll(async () => {
    db = await freshTestDb();
    server = await buildServer(db);
    const password = (await db.getAppMeta('initial_password'))!;
    adminCookie = await signIn('admin', password);

    const hash = await bcrypt.hash('readerpw', 4);
    const reader = await db.createUser('reader', hash, false);
    await db.upsertCredentialAccount(reader.id, 'reader', hash);
    readerCookie = await signIn('reader', 'readerpw');
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  it('GET /api/settings/version reports the running package version', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/settings/version', headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body)) as { version: string };
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });

  it('cache stats are admin-only and shaped like both caches', async () => {
    const ok = await server.inject({ method: 'GET', url: '/api/admin/cache', headers: { cookie: adminCookie } });
    expect(ok.statusCode).toBe(200);
    const body = JSON.parse(String(ok.body)) as { imageCache: unknown; upscaleCache: unknown };
    expect(body.imageCache).toBeDefined();
    expect(body.upscaleCache).toBeDefined();

    const denied = await server.inject({ method: 'GET', url: '/api/admin/cache', headers: { cookie: readerCookie } });
    expect(denied.statusCode).toBe(403);
  });

  it('DELETE /api/admin/cache clears both caches', async () => {
    const res = await server.inject({ method: 'DELETE', url: '/api/admin/cache', headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(String(res.body)) as { ok: boolean }).ok).toBe(true);
  });

  it('backup requires an admin session', async () => {
    const denied = await server.inject({ method: 'GET', url: '/api/admin/backup', headers: { cookie: readerCookie } });
    expect(denied.statusCode).toBe(403);
  });
});
