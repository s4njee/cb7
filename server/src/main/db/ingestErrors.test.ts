import { afterEach, beforeEach, expect, it } from 'vitest';
import { describePg, freshTestDb } from '../test/pgTestDb';
import { LibraryDatabase } from '../libraryDatabase';

let db: LibraryDatabase;

// Runs only when CB8_TEST_DATABASE_URL is set (see src/main/test/pgTestDb.ts).
describePg('ingest_errors DAO', () => {
  beforeEach(async () => { db = await freshTestDb(); });
  afterEach(async () => { await db?.close(); });

  it('records failures, reads them back newest-first, and round-trips every field', async () => {
    expect(await db.countIngestErrors()).toBe(0);
    expect(await db.getRecentIngestErrors()).toEqual([]);

    await db.recordIngestError({
      path: 'C:/library/one.cbz', ext: '.cbz', errorClass: 'archive_open', message: 'bad zip',
    });
    await db.recordIngestError({
      path: 'C:/library/two.cbr', ext: '.cbr', errorClass: 'timeout', message: 'timed out',
    });

    expect(await db.countIngestErrors()).toBe(2);

    const recent = await db.getRecentIngestErrors();
    expect(recent.map((r) => r.path)).toEqual(['C:/library/two.cbr', 'C:/library/one.cbz']);
    // Full field round-trip (newest entry), including an ISO timestamp.
    expect(recent[0]).toMatchObject({
      path: 'C:/library/two.cbr', ext: '.cbr', errorClass: 'timeout', message: 'timed out',
    });
    expect(recent[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z$/);
  });

  it('honors the limit and clears all rows', async () => {
    await db.recordIngestError({ path: 'a.cbz', ext: '.cbz', errorClass: 'unknown', message: 'a' });
    await db.recordIngestError({ path: 'b.cbz', ext: '.cbz', errorClass: 'unknown', message: 'b' });
    await db.recordIngestError({ path: 'c.cbz', ext: '.cbz', errorClass: 'unknown', message: 'c' });

    expect((await db.getRecentIngestErrors(1)).map((r) => r.path)).toEqual(['c.cbz']);

    await db.clearIngestErrors();
    expect(await db.countIngestErrors()).toBe(0);
    expect(await db.getRecentIngestErrors()).toEqual([]);
  });

  it('associates failures with a scan job and fetches them newest-first', async () => {
    await db.recordIngestError({ path: 'job1-a.cbz', ext: '.cbz', errorClass: 'archive_open', message: 'bad zip', jobId: 'job-1' });
    await db.recordIngestError({ path: 'job1-b.cbz', ext: '.cbz', errorClass: 'timeout', message: 'timed out', jobId: 'job-1' });
    await db.recordIngestError({ path: 'no-job.cbz', ext: '.cbz', errorClass: 'unknown', message: 'unassociated' });

    const jobFailures = await db.getIngestErrorsForJob('job-1');
    expect(jobFailures.map((f) => f.path)).toEqual(['job1-b.cbz', 'job1-a.cbz']);
    expect(jobFailures[0]).toMatchObject({
      path: 'job1-b.cbz', ext: '.cbz', errorClass: 'timeout', message: 'timed out',
    });
    expect(jobFailures[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z$/);

    // Failures recorded without a job (API uploads) stay out of the job's list,
    // and an unknown job id returns empty.
    expect(await db.getIngestErrorsForJob('missing')).toEqual([]);
  });
});
