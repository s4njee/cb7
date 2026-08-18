import { afterEach, beforeEach, expect, it } from 'vitest';
import { describePg, freshTestDb } from '../test/pgTestDb';
import type { LibraryDatabase } from '../libraryDatabase';

/**
 * Watched library roots (drop-folder ingest): `scan_path` / `auto_scan_enabled`
 * on folders, the roots list, and the per-folder newest-scan-job lookup.
 * Runs only when CB8_TEST_DATABASE_URL is set (see src/main/test/pgTestDb.ts).
 */
describePg('watched library roots', () => {
  let db: LibraryDatabase;

  beforeEach(async () => {
    db = await freshTestDb();
  });
  afterEach(async () => {
    await db?.close();
  });

  it('createFolder persists a scan root; virtual folders have none', async () => {
    const watched = await db.createFolder('Incoming', [], '/data/incoming');
    const virtual = await db.createFolder('Favorites', [], null);

    const roots = await db.getWatchedRoots();
    const root = roots.find((r) => r.id === watched.id);
    expect(root?.scanPath).toBe('/data/incoming');
    expect(root?.autoScanEnabled).toBe(true);
    expect(root?.comicCount).toBe(0);
    expect(roots.some((r) => r.id === virtual.id)).toBe(false);

    const all = await db.getAllFolders();
    expect(all.find((f) => f.id === watched.id)?.scanPath).toBe('/data/incoming');
    expect(all.find((f) => f.id === watched.id)?.autoScanEnabled).toBe(true);
    expect(all.find((f) => f.id === virtual.id)?.scanPath).toBeNull();
  });

  it('an empty root is a valid watch target (no comics yet)', async () => {
    await db.createFolder('Drop', [], '/data/drop');
    const roots = await db.getWatchedRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0].comicCount).toBe(0);
  });

  it('setFolderScanRoot writes and clears the root', async () => {
    const folder = await db.createFolder('F', []);
    expect((await db.getWatchedRoots()).length).toBe(0);

    await db.setFolderScanRoot(folder.id, '/data/incoming');
    let roots = await db.getWatchedRoots();
    expect(roots[0].scanPath).toBe('/data/incoming');

    await db.setFolderScanRoot(folder.id, null);
    roots = await db.getWatchedRoots();
    expect(roots.length).toBe(0);
  });

  it('setFolderAutoScanEnabled toggles the scheduler gate', async () => {
    const folder = await db.createFolder('F', [], '/data/incoming');
    await db.setFolderAutoScanEnabled(folder.id, false);
    expect((await db.getWatchedRoots())[0].autoScanEnabled).toBe(false);

    await db.setFolderAutoScanEnabled(folder.id, true);
    expect((await db.getWatchedRoots())[0].autoScanEnabled).toBe(true);
  });

  it('getLatestScanJobForFolders returns the newest scan_jobs row per folder', async () => {
    const a = await db.createFolder('A', [], '/data/a');
    const b = await db.createFolder('B', [], '/data/b');
    const c = await db.createFolder('C', [], '/data/c'); // no jobs at all

    await db.createScanJob({ id: 'j-old', kind: 'ingest-scan', targetPath: '/data/a', folderId: a.id });
    await db.createScanJob({ id: 'j-new', kind: 'ingest-scan', targetPath: '/data/a', folderId: a.id });
    await db.createScanJob({ id: 'j-b', kind: 'ingest-scan', targetPath: '/data/b', folderId: b.id });
    // Force a deterministic ordering (created_at is second-granularity text).
    await db.pool.query('UPDATE scan_jobs SET created_at = $1 WHERE id = $2', ['2026-01-01 00:00:00', 'j-old']);
    await db.pool.query('UPDATE scan_jobs SET created_at = $1 WHERE id = $2', ['2026-01-02 00:00:00', 'j-new']);
    await db.pool.query('UPDATE scan_jobs SET created_at = $1 WHERE id = $2', ['2026-01-03 00:00:00', 'j-b']);

    await db.updateScanProgress('j-new', { status: 'done', added: 3 });
    await db.updateScanProgress('j-b', { status: 'active' });

    const latest = await db.getLatestScanJobForFolders([a.id, b.id, c.id]);
    expect(latest.get(a.id)?.id).toBe('j-new');
    expect(latest.get(a.id)?.status).toBe('done');
    expect(latest.get(a.id)?.added).toBe(3);
    expect(latest.get(b.id)?.id).toBe('j-b');
    expect(latest.get(b.id)?.status).toBe('active');
    // Folders with no jobs (or no folders at all) are simply absent.
    expect(latest.has(c.id)).toBe(false);
    expect(latest.has(0)).toBe(false);
  });
});
