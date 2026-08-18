/**
 * @module
 * Postgres connection + schema bootstrap (server)
 *
 * Architecture overview for Junior Devs:
 * The Postgres analogue of `open.ts`'s `openOrRecreate`. It builds a `pg.Pool`
 * from a connection string, applies the idempotent schema once (so a fresh
 * database is provisioned on first boot and existing ones are left untouched),
 * and hands back the async {@link PgDatabase} helper the data layer uses.
 *
 * There is deliberately no corrupt-file detection / wipe-and-recreate fallback
 * here — that was a SQLite-on-disk concern. Postgres manages durability itself.
 */
import { Pool } from 'pg';
import { PgDatabase } from '../pg';
import { PG_SCHEMA } from './createPg';

/**
 * Connect to Postgres and ensure the schema exists.
 *
 * @param connectionString A libpq URL, e.g. `postgres://user:pw@host:5432/cb8`.
 * @returns A connected {@link PgDatabase} ready for the facade to use.
 */
export async function openPg(connectionString: string): Promise<PgDatabase> {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Apply the schema on a single client. `PG_SCHEMA` is several semicolon-
  // separated statements; node-postgres runs them together via the simple query
  // protocol (no bind parameters in DDL). Every statement is `IF NOT EXISTS`, so
  // this is safe to run on each startup.
  const client = await pool.connect();
  try {
    await client.query(PG_SCHEMA);
  } finally {
    client.release();
  }

  return new PgDatabase(pool);
}
