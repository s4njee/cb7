/**
 * @module
 * BEGIN/COMMIT Transaction Helper for node:sqlite
 *
 * Architecture overview for Junior Devs:
 * A transaction groups several DB writes so they all succeed or all fail
 * together. `better-sqlite3` ships a handy `db.transaction(fn)` wrapper, but
 * `node:sqlite`'s `DatabaseSync` does not, so this file provides the equivalent.
 */

import type { DatabaseSync } from 'node:sqlite';

/**
 * Run a function inside a single SQLite transaction.
 *
 * Issues `BEGIN`, runs `fn`, then `COMMIT`. If `fn` throws, it issues
 * `ROLLBACK` and re-throws the original error. Do not nest calls — SQLite has no
 * nested transactions without savepoints, which this helper doesn't use.
 *
 * @typeParam T The value returned by `fn`.
 * @param db The open database connection.
 * @param fn The work to perform atomically.
 * @returns Whatever `fn` returns, once the commit succeeds.
 */
export function runTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore rollback errors */ }
    throw err;
  }
}
