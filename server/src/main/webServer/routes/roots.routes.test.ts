import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describePg, freshTestDb, TEST_DB_URL } from '../../test/pgTestDb';
import type { LibraryDatabase } from '../../libraryDatabase';
import { buildServer } from '../server';
import { startBoss } from '../../jobs/boss';

/**
 * @module
 * Route-level tests for the watched-roots endpoints in `routes/folders.ts`.
 *
 * Drives the real Fastify server over a real Postgres (opt-in via
 * `CB8_TEST_DATABASE_URL`, self-skips without it) so the wire shapes and the
 * register → list → toggle → rescan-all → remove lifecycle are exercised
 * together. pg-boss is started producer-only so the enqueue routes work.
 *
 * Like the other Pg suites, run with `--no-file-parallelism` (the shared test
 * DB is TRUNCATEd by `freshTestDb`).
 */

let db: LibraryDatabase;
let server: FastifyInstance;
let cookie: string;
const tempDirs: string[] = [];

function jsonBody<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(';')[0]).join('; ');
}

interface RootRow {
  folderId: number;
  name: string;
  scanPath: string;
  enabled: boolean;
  comicCount: number;
  pathExists: boolean;
  lastScanAt: number | null;
  lastScanJob: { status: string; error: string | null; added: number; updatedAt: string } | null;
}

describePg('watched roots routes', () => {
  beforeAll(async () => {
    db = await freshTestDb();
    // buildServer runs ensureInitialAdmin, which seeds `admin` + the generated
    // password in app_meta — so it must come after freshTestDb()'s TRUNCATE.
    server = await buildServer(db);
    await startBoss(TEST_DB_URL, { producerOnly: true });
    const password = await db.getAppMeta('initial_password');
    const signIn = await server.inject({
      method: 'POST',
      url: '/api/auth/sign-in/username',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'admin', password }),
    });
    expect(signIn.statusCode).toBe(200);
    cookie = cookieHeader(signIn.headers['set-cookie']);
    expect(cookie).not.toBe('');
  });

  afterAll(async () => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
    await server?.close();
    await db?.close();
  });

  const listRoots = async (): Promise<RootRow[]> =>
    jsonBody<RootRow[]>((await server.inject({
      method: 'GET',
      url: '/api/roots',
      headers: { cookie },
    })).payload);

  it('registers, lists, toggles, and unregisters a watched root', async () => {
    const folder = await db.createFolder('Incoming', []);
    const missingPath = path.join(os.tmpdir(), 'cb8-root-route-missing');

    // Register a root whose path doesn't exist yet → no immediate scan, offline badge.
    const put = await server.inject({
      method: 'PUT',
      url: `/api/roots/${folder.id}`,
      headers: { 'content-type': 'application/json', cookie },
      payload: JSON.stringify({ scanPath: missingPath }),
    });
    expect(put.statusCode).toBe(200);
    expect(jsonBody<{ ok: boolean; jobId: string | null }>(put.payload)).toEqual({ ok: true, jobId: null, alreadyQueued: false });

    let roots = await listRoots();
    expect(roots).toHaveLength(1);
    const root = roots[0];
    expect(root.folderId).toBe(folder.id);
    expect(root.name).toBe('Incoming');
    expect(root.scanPath).toBe(missingPath);
    expect(root.enabled).toBe(true);
    expect(root.comicCount).toBe(0);
    expect(root.pathExists).toBe(false);
    expect(root.lastScanJob).toBeNull();

    // Disable auto-scan.
    const toggle = await server.inject({
      method: 'PUT',
      url: `/api/roots/${folder.id}`,
      headers: { 'content-type': 'application/json', cookie },
      payload: JSON.stringify({ enabled: false }),
    });
    expect(toggle.statusCode).toBe(200);
    roots = await listRoots();
    expect(roots[0].enabled).toBe(false);

    // Remove the watch — folder and catalog rows survive.
    const del = await server.inject({
      method: 'DELETE',
      url: `/api/roots/${folder.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    expect(await listRoots()).toHaveLength(0);
  });

  it('registering an existing path enqueues an immediate scan (single-flight on rescan-all)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb8-root-existing-'));
    tempDirs.push(dir);
    const folder = await db.createFolder('Drop', []);

    const put = await server.inject({
      method: 'PUT',
      url: `/api/roots/${folder.id}`,
      headers: { 'content-type': 'application/json', cookie },
      payload: JSON.stringify({ scanPath: dir }),
    });
    expect(put.statusCode).toBe(200);
    const body = jsonBody<{ ok: boolean; jobId: string | null; alreadyQueued: boolean }>(put.payload);
    expect(body.ok).toBe(true);
    expect(body.jobId).toBeTruthy();
    expect(body.alreadyQueued).toBe(false);

    const root = (await listRoots()).find((r) => r.folderId === folder.id)!;
    expect(root.pathExists).toBe(true);
    // The enqueue route also mirrored a scan_jobs row (queued) for the UI.
    expect(root.lastScanJob?.status).toBe('queued');

    // Rescan-all: the same path's scan is already queued → deduped, not duplicated.
    const rescanAll = await server.inject({
      method: 'POST',
      url: '/api/roots/rescan-all',
      headers: { cookie },
    });
    expect(rescanAll.statusCode).toBe(200);
    const ra = jsonBody<{ enqueued: number; jobs: Array<{ folderId: number; jobId: string | null; alreadyQueued: boolean }> }>(rescanAll.payload);
    expect(ra.enqueued).toBe(0);
    expect(ra.jobs).toHaveLength(1);
    expect(ra.jobs[0].folderId).toBe(folder.id);
    expect(ra.jobs[0].alreadyQueued).toBe(true);
  });

  it('rescans an empty root from its stored path (no more derive-from-comics 400)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb8-root-empty-'));
    tempDirs.push(dir);
    const folder = await db.createFolder('EmptyDrop', []);

    const put = await server.inject({
      method: 'PUT',
      url: `/api/roots/${folder.id}`,
      headers: { 'content-type': 'application/json', cookie },
      payload: JSON.stringify({ scanPath: dir }),
    });
    expect(put.statusCode).toBe(200);
    expect(jsonBody<{ jobId: string | null }>(put.payload).jobId).toBeTruthy();

    const rescan = await server.inject({
      method: 'POST',
      url: `/api/folders/${folder.id}/rescan`,
      headers: { cookie },
    });
    // Enqueued (202) or deduped against the register scan (200) — never the old 400.
    expect([200, 202]).toContain(rescan.statusCode);
  });
});
