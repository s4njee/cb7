import type { Db } from './pg';
import type { CountRow } from './types';

/**
 * @module
 * User Account Database Operations
 *
 * Architecture overview for Junior Devs:
 * CRUD for the `users` table plus a bridge to authentication. Two things to
 * know:
 *  - `is_admin` is a real Postgres `BOOLEAN`; these helpers pass/return JS
 *    booleans directly.
 *  - Authentication is handled by the `better-auth` library, which reads its
 *    own `account` table. `upsertCredentialAccount` keeps that table in sync
 *    with our `users.password_hash` so both the legacy and better-auth login
 *    paths agree on the password.
 *
 * User timestamps live in `timestamptz` columns (better-auth writes them); reads
 * that the app treats as strings cast them with `to_char` to the SQLite shape.
 */

/** Cast a user timestamptz column to the legacy `YYYY-MM-DD HH:MM:SS` string. */
const CREATED_AT_TEXT = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;

/**
 * Insert a new user.
 *
 * Populates `email` / `email_verified` / `display_username` / `name` up front:
 * better-auth's username plugin validates the returned user shape on sign-in and
 * rejects rows where those are null, so without them an admin-created (or
 * registered) account could never actually sign in. There's no real email in
 * this self-hosted, username-first model, so we synthesize `username@localhost`.
 * @returns The new user's id, username, and admin flag.
 */
export async function createUser(
  db: Db,
  username: string,
  passwordHash: string,
  isAdmin: boolean,
): Promise<{ id: number; username: string; isAdmin: boolean }> {
  const row = (await db.get<{ id: number }>(
    `INSERT INTO users (username, password_hash, is_admin, email, email_verified, display_username, name)
     VALUES (?, ?, ?, ?, true, ?, ?) RETURNING id`,
    [username, passwordHash, isAdmin, `${username}@localhost`, username, username],
  ))!;
  return { id: row.id, username, isAdmin };
}

/**
 * Look up a user by name (case-insensitive), including the password hash.
 * @returns The user with its `passwordHash`, or `null` if not found.
 */
export async function getUserByUsername(
  db: Db,
  username: string,
): Promise<{ id: number; username: string; passwordHash: string; isAdmin: boolean; createdAt: string } | null> {
  const row = await db.get<{ id: number; username: string; password_hash: string; is_admin: boolean; created_at: string }>(
    `SELECT id, username, password_hash, is_admin, ${CREATED_AT_TEXT} AS created_at FROM users WHERE lower(username) = lower(?)`,
    [username],
  );
  if (!row) return null;
  return { id: row.id, username: row.username, passwordHash: row.password_hash, isAdmin: !!row.is_admin, createdAt: row.created_at };
}

/**
 * Look up a user by id (no password hash returned).
 * @returns The user, or `null` if no row matches.
 */
export async function getUserById(
  db: Db,
  id: number,
): Promise<{ id: number; username: string; isAdmin: boolean; createdAt: string } | null> {
  const row = await db.get<{ id: number; username: string; is_admin: boolean; created_at: string }>(
    `SELECT id, username, is_admin, ${CREATED_AT_TEXT} AS created_at FROM users WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return { id: row.id, username: row.username, isAdmin: !!row.is_admin, createdAt: row.created_at };
}

/** List all users ordered by username (case-insensitive). */
export async function listUsers(db: Db): Promise<{ id: number; username: string; isAdmin: boolean; createdAt: string }[]> {
  const rows = await db.all<{ id: number; username: string; is_admin: boolean; created_at: string }>(
    `SELECT id, username, is_admin, ${CREATED_AT_TEXT} AS created_at FROM users ORDER BY lower(username)`,
  );
  return rows.map((r) => ({ id: r.id, username: r.username, isAdmin: !!r.is_admin, createdAt: r.created_at }));
}

/** Count admin users — used to prevent deleting the last admin. */
export async function countAdmins(db: Db): Promise<number> {
  const row = await db.get<CountRow>('SELECT COUNT(*) as cnt FROM users WHERE is_admin = true');
  return row?.cnt ?? 0;
}

/** Count all users — used to detect first-run (no accounts yet). */
export async function countUsers(db: Db): Promise<number> {
  const row = await db.get<CountRow>('SELECT COUNT(*) as cnt FROM users');
  return row?.cnt ?? 0;
}

/** Delete a user by id. */
export async function deleteUser(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM users WHERE id = ?', [id]);
}

/** Grant or revoke admin rights for a user. */
export async function setUserAdmin(db: Db, id: number, isAdmin: boolean): Promise<void> {
  await db.run('UPDATE users SET is_admin = ? WHERE id = ?', [isAdmin, id]);
}

/**
 * Reset a user's password and backfill the fields better-auth's native sign-in
 * requires (email, display_username, name), marking the row a verified admin.
 * Backs the "Reset admin password…" safety hatch.
 */
export async function resetAdminCredentials(
  db: Db,
  id: number,
  passwordHash: string,
  username: string,
): Promise<void> {
  await db.run(
    `UPDATE users
        SET password_hash = ?,
            email = COALESCE(email, ?),
            email_verified = true,
            display_username = COALESCE(display_username, ?),
            name = COALESCE(name, ?),
            is_admin = true,
            updated_at = now()
      WHERE id = ?`,
    [passwordHash, `${username}@localhost`, username, username, id],
  );
}

/**
 * Create or update the better-auth credential `account` row for a user.
 *
 * `better-auth` verifies passwords against its own `account` table, not
 * our `users.password_hash`. This keeps the two in sync (insert if missing,
 * update otherwise) so both the legacy and better-auth login paths accept the
 * same password.
 *
 * @param db The async database handle.
 * @param userId The user the account belongs to.
 * @param accountId The better-auth account identifier.
 * @param passwordHash The hashed password to store.
 */
export async function upsertCredentialAccount(
  db: Db,
  userId: number,
  accountId: string,
  passwordHash: string,
): Promise<void> {
  const existing = await db.get<{ id: number }>(
    `SELECT id FROM account WHERE user_id = ? AND provider_id = 'credential'`,
    [userId],
  );
  if (existing) {
    await db.run(
      `UPDATE account SET password = ?, account_id = ?, updated_at = now() WHERE id = ?`,
      [passwordHash, accountId, existing.id],
    );
  } else {
    await db.run(
      `INSERT INTO account (user_id, account_id, provider_id, password, created_at, updated_at)
       VALUES (?, ?, 'credential', ?, now(), now())`,
      [userId, accountId, passwordHash],
    );
  }
}
