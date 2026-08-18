import type { Db } from './pg';

/**
 * @module
 * Database Operations for QR Device-Pairing Tokens
 *
 * Architecture overview for Junior Devs:
 * Owns the `pair_tokens` table — the short-lived, single-use codes behind the
 * "Pair a device" QR (see `reader/docs/CONTRACT.md`, "Pair tokens"). A phone
 * scans a QR carrying an opaque token and POSTs it to `/api/auth/pair`, which
 * signs it in as the user who minted it. That makes a live token equivalent to a
 * password, so this module is written defensively:
 *
 *  - **Only hashes live here.** Callers pass `sha256(token)` (lowercase hex);
 *    the plaintext never reaches the database layer, and nothing here logs.
 *  - **Single-use is a DELETE, not a SELECT-then-DELETE.** `consumePairToken`
 *    deletes and returns in one statement, so two devices racing the same QR
 *    can't both win — Postgres hands the row to exactly one of them.
 *  - **Expiry is in the same WHERE clause** as the consume, so a token can't
 *    slip through between an expiry check and a delete.
 *
 * Free functions taking the async DB handle, surfaced through `libraryDatabase.ts`.
 */

/**
 * Store a freshly minted pairing token.
 * @param db The database handle.
 * @param userId The user the token will sign in as.
 * @param tokenHash `sha256(token)` as lowercase hex — never the plaintext.
 * @param expiresAt When the token stops being redeemable.
 */
export async function createPairToken(
  db: Db,
  userId: number,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await db.run(
    'INSERT INTO pair_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash, expiresAt],
  );
}

/**
 * Atomically redeem a pairing token.
 *
 * The `DELETE ... WHERE token_hash = ? AND expires_at > now() RETURNING user_id`
 * is deliberately one statement: it is what makes the token single-use. Splitting
 * it into a lookup and a delete would let two devices that scanned the same QR
 * both pass the lookup before either deleted, handing out two sessions from one
 * code. It also means an expired row is never redeemable even if the sweep
 * hasn't reached it yet.
 *
 * Note there is no plaintext comparison anywhere: the caller hashes the token it
 * was given and we match on `token_hash`. The index probe *is* the comparison,
 * which is both constant-time from the attacker's perspective and stronger than
 * a JS `timingSafeEqual` over the raw secret.
 *
 * @param db The database handle.
 * @param tokenHash `sha256(token)` as lowercase hex.
 * @returns The bound user's id, or `null` when the token is unknown, already
 *          used, or expired — the caller must not distinguish these.
 */
export async function consumePairToken(db: Db, tokenHash: string): Promise<number | null> {
  const result = await db.run(
    'DELETE FROM pair_tokens WHERE token_hash = ? AND expires_at > now() RETURNING user_id',
    [tokenHash],
  );
  const row = result.rows[0] as { user_id: number } | undefined;
  return row?.user_id ?? null;
}

/**
 * Delete every expired pairing token.
 *
 * Called opportunistically on each mint rather than on a timer: pairing is rare
 * and bursty, so the table stays small without a background job, and expired
 * rows never accumulate on a long-running server.
 *
 * @param db The database handle.
 * @returns How many rows were swept.
 */
export async function sweepExpiredPairTokens(db: Db): Promise<number> {
  const result = await db.run('DELETE FROM pair_tokens WHERE expires_at <= now()');
  return result.rowCount;
}
