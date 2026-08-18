/**
 * @module
 * Async Postgres helper (server data layer)
 *
 * Architecture overview for Junior Devs:
 * The CB8 server originally ran on `better-sqlite3`, whose API is *synchronous*
 * (`db.prepare(sql).get(params)`). Postgres' driver (`pg`) is *asynchronous*, so
 * the data layer is now promise-based. This helper gives the DAO functions in
 * `src/main/db/*.ts` an ergonomic, minimal surface that mirrors the old one:
 *
 *   - `all(sql, params)` → every row
 *   - `get(sql, params)` → the first row (or `undefined`)
 *   - `run(sql, params)` → `{ rowCount, rows }` (use `RETURNING` to read new ids)
 *   - `tx(fn)`           → run `fn` inside one `BEGIN/COMMIT` (auto `ROLLBACK`)
 *
 * The existing SQL is written with SQLite-style positional `?` placeholders;
 * `convertPlaceholders` rewrites those to Postgres `$1..$n` at call time, so the
 * bulk of the SQL strings port unchanged.
 *
 * Both {@link PgDatabase} (pool-backed) and {@link PgTx} (single-client, inside a
 * transaction) implement the shared {@link Db} interface, so a DAO function can
 * be handed either and behave identically.
 */
import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

// Postgres returns int8 (bigint) — including every COUNT(*) — and numeric as
// strings to avoid precision loss. CB8's bigint values (file sizes, row counts)
// are always within JS's safe-integer range, so parse them back to numbers to
// match the old better-sqlite3 behavior the DAO/API code expects.
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

/**
 * SQL expression matching SQLite's `datetime('now')` — `YYYY-MM-DD HH:MM:SS` in
 * UTC. Used in DAO inserts/updates that wrote `datetime('now')` so the stored
 * (TEXT) timestamps keep their original format in API responses.
 */
export const NOW_TEXT_SQL = "to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')";

/** The read/write surface shared by the pool helper and a transaction handle. */
export interface Db {
  all<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ rowCount: number; rows: QueryResultRow[] }>;
}

async function queryAll<T extends QueryResultRow>(
  q: Pool | PoolClient,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const res = await q.query<T>(convertPlaceholders(sql), params as unknown[]);
  return res.rows;
}

/** Pool-backed database handle. One per server process. */
export class PgDatabase implements Db {
  constructor(private readonly pool: Pool) {}

  /** The underlying pg Pool — handed to better-auth as its database. */
  get pool_(): Pool {
    return this.pool;
  }

  all<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return queryAll<T>(this.pool, sql, params);
  }

  async get<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await queryAll<T>(this.pool, sql, params);
    return rows[0];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ rowCount: number; rows: QueryResultRow[] }> {
    const res = await this.pool.query(convertPlaceholders(sql), params as unknown[]);
    return { rowCount: res.rowCount ?? 0, rows: res.rows };
  }

  /**
   * Run `fn` inside a single transaction on a dedicated client. Commits on
   * success, rolls back on any throw. Used by the ingest pipeline to batch many
   * inserts into one commit.
   */
  async tx<T>(fn: (tx: PgTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PgTx(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore rollback failure; surface the original error */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Transaction-scoped handle bound to a single client (same surface as {@link Db}). */
export class PgTx implements Db {
  constructor(private readonly client: PoolClient) {}

  all<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return queryAll<T>(this.client, sql, params);
  }

  async get<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await queryAll<T>(this.client, sql, params);
    return rows[0];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ rowCount: number; rows: QueryResultRow[] }> {
    const res = await this.client.query(convertPlaceholders(sql), params as unknown[]);
    return { rowCount: res.rowCount ?? 0, rows: res.rows };
  }
}

/**
 * Rewrite SQLite-style positional `?` placeholders to Postgres `$1..$n`.
 *
 * `?` characters inside single-quoted string literals are left untouched so a
 * literal question mark in text never gets mistaken for a bind parameter.
 */
export function convertPlaceholders(sql: string): string {
  let index = 0;
  let inString = false;
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // Doubled '' is an escaped quote inside a string — keep the state.
      if (inString && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inString = !inString;
      out += ch;
    } else if (ch === '?' && !inString) {
      out += `$${++index}`;
    } else {
      out += ch;
    }
  }
  return out;
}
