import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Job } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { describePg, freshTestDb, TEST_DB_URL } from '../test/pgTestDb';
import type { LibraryDatabase } from '../libraryDatabase';
import { handleIngestScan } from './handlers';
import { startBoss, stopBoss, getBoss } from './boss';
import { enqueueScan } from './producer';
import { QUEUE, type IngestScanJob } from './queues';

/** Fabricate a pg-boss Job for direct handler testing (no live queue needed). */
function makeJob<T extends object>(id: string, data: T, signal?: AbortSignal): Job<T> {
  return {
    id,
    name: 'test',
    data,
    expireInSeconds: 3600,
    heartbeatSeconds: null,
    signal: signal ?? new AbortController().signal,
  } as Job<T>;
}

describePg('scan_jobs DAO', () => {
  let db: LibraryDatabase;
  beforeEach(async () => { db = await freshTestDb(); });
  afterEach(async () => { await db?.close(); });

  it('creates, patches, and reads back a job; createScanJob is idempotent', async () => {
    await db.createScanJob({ id: 'job-1', kind: 'ingest-scan', targetPath: '/lib/a', folderId: 7 });
    // Second create with the same id is a no-op (ON CONFLICT DO NOTHING).
    await db.createScanJob({ id: 'job-1', kind: 'ingest-scan', targetPath: '/lib/a', folderId: 7 });

    await db.updateScanProgress('job-1', { status: 'active', discovered: 10, processed: 4, currentFile: 'a.cbz' });
    const mid = await db.getScanJob('job-1');
    expect(mid?.status).toBe('active');
    expect(mid?.discovered).toBe(10);
    expect(mid?.processed).toBe(4);
    expect(mid?.targetPath).toBe('/lib/a');
    expect(mid?.folderId).toBe(7);
  });

  it('lists active jobs and drops them once terminal', async () => {
    await db.createScanJob({ id: 'a', kind: 'ingest-scan', targetPath: '/lib/x' });
    await db.createScanJob({ id: 'b', kind: 'ingest-scan', targetPath: '/lib/y' });
    await db.updateScanProgress('a', { status: 'active' });

    expect((await db.listActiveScanJobs()).map((j) => j.id).sort()).toEqual(['a', 'b']);
    expect((await db.findActiveScanByPath('/lib/x'))?.id).toBe('a');

    await db.updateScanProgress('a', { status: 'done' });
    expect((await db.listActiveScanJobs()).map((j) => j.id)).toEqual(['b']);
    expect(await db.findActiveScanByPath('/lib/x')).toBeUndefined();
  });
});

describePg('ingest-scan handler', () => {
  let db: LibraryDatabase;
  let tmpDir: string;
  beforeEach(async () => {
    db = await freshTestDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb8-ingest-'));
  });
  afterEach(async () => {
    await db?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs a scan over a dir with no media and marks the job done', async () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'not a comic');
    await handleIngestScan(db, makeJob<IngestScanJob>('scan-done', { targetPath: tmpDir }));

    const job = await db.getScanJob('scan-done');
    expect(job?.status).toBe('done');
    expect(job?.added).toBe(0);
    expect(job?.error).toBeNull();
  });

  it('records an error (but still terminates) for an unreadable path', async () => {
    const missing = path.join(tmpDir, 'does', 'not', 'exist');
    await handleIngestScan(db, makeJob<IngestScanJob>('scan-missing', { targetPath: missing }));

    const job = await db.getScanJob('scan-missing');
    expect(job?.status).toBe('done');
    expect(job?.error).toBeTruthy();
  });

  it('throws on an aborted signal so pg-boss re-delivers (resumes) the job', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      handleIngestScan(db, makeJob<IngestScanJob>('scan-aborted', { targetPath: tmpDir }, ac.signal)),
    ).rejects.toThrow(/aborted/);
    const job = await db.getScanJob('scan-aborted');
    expect(job?.status).toBe('failed');
  });
});

describePg('producer dedupe (pg-boss)', () => {
  let db: LibraryDatabase;
  beforeAll(async () => {
    db = await freshTestDb();
    await startBoss(TEST_DB_URL);
  });
  afterAll(async () => {
    try { await getBoss().deleteAllJobs(QUEUE.ingestScan); } catch { /* ignore */ }
    await stopBoss();
    await db?.close();
  });

  it('dedupes a second scan of the same path via singletonKey', async () => {
    const target = `/lib/dedupe-${Date.now()}`;
    const first = await enqueueScan({ targetPath: target });
    const second = await enqueueScan({ targetPath: target });
    const other = await enqueueScan({ targetPath: `${target}-other` });

    expect(first).toBeTruthy();
    expect(second).toBeNull(); // already queued under the same singletonKey
    expect(other).toBeTruthy();
  });
});
