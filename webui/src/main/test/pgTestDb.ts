/**
 * @module
 * Postgres integration-test harness.
 *
 * These suites need a real, disposable Postgres (the schema uses pgvector,
 * generated tsvector columns, and `to_char`, which in-memory shims can't model).
 * They are opt-in: set `CB8_TEST_DATABASE_URL` to a throwaway database and they
 * run; leave it unset and they skip, so `pnpm test` stays green without Docker.
 *
 * Spin one up locally with the same image production uses:
 *   docker run --rm -e POSTGRES_PASSWORD=test -e POSTGRES_DB=cb8 \
 *     -p 5433:5432 pgvector/pgvector:pg16
 *   CB8_TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/cb8 pnpm test
 */
import { describe } from 'vitest';
import { LibraryDatabase } from '../libraryDatabase';

export const TEST_DB_URL = process.env.CB8_TEST_DATABASE_URL ?? '';
export const hasPg = TEST_DB_URL.length > 0;

/** `describe()` that runs only when CB8_TEST_DATABASE_URL is set; skips otherwise. */
export function describePg(name: string, fn: () => void): void {
  (hasPg ? describe : describe.skip)(name, fn);
}

/** Top-level tables wiped between tests; CASCADE clears dependent rows. */
const TRUNCATE_SQL =
  'TRUNCATE comics, scan_jobs, ingest_errors, folders, libraries, tags, users, app_meta, dismissed_paths RESTART IDENTITY CASCADE';

/** Create an initialized LibraryDatabase against the test DB, with catalog rows wiped. */
export async function freshTestDb(): Promise<LibraryDatabase> {
  const db = new LibraryDatabase(TEST_DB_URL);
  await db.initialize();
  await db.pool.query(TRUNCATE_SQL);
  return db;
}
