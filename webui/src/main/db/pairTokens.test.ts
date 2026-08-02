import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import { describePg, freshTestDb } from '../test/pgTestDb';
import type { LibraryDatabase } from '../libraryDatabase';

/**
 * Postgres-gated tests for the QR pairing-token store (QR-4).
 *
 * These need a real Postgres — the whole point of `consumePairToken` is that
 * `DELETE ... WHERE ... RETURNING` is atomic, and `expires_at > now()` is
 * evaluated by the server's clock. An in-memory shim would model neither, so the
 * properties that make the token single-use would go untested. Set
 * `CB8_TEST_DATABASE_URL` to a throwaway database to run them (see pgTestDb.ts).
 */

/** Hash a token the way the route layer does: sha256, lowercase hex. */
const hash = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

describePg('pairTokens', () => {
  let db: LibraryDatabase;
  let userId: number;

  beforeEach(async () => {
    db = await freshTestDb();
    const user = await db.createUser('pairuser', 'not-a-real-hash', false);
    userId = user.id;
  });

  afterEach(async () => {
    await db.close();
  });

  const inMinutes = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);

  it('mints a token and consumes it back to the bound user', async () => {
    await db.createPairToken(userId, hash('token-a'), inMinutes(2));
    expect(await db.consumePairToken(hash('token-a'))).toBe(userId);
  });

  it('stores only the hash — the plaintext never reaches the table', async () => {
    await db.createPairToken(userId, hash('super-secret-token'), inMinutes(2));
    const rows = await db.pool.query<{ token_hash: string }>('SELECT token_hash FROM pair_tokens');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].token_hash).toBe(hash('super-secret-token'));
    // Belt and braces: no column anywhere in the row contains the plaintext.
    const all = await db.pool.query('SELECT * FROM pair_tokens');
    expect(JSON.stringify(all.rows)).not.toContain('super-secret-token');
  });

  it('is single-use: a second consume of the same token fails', async () => {
    await db.createPairToken(userId, hash('token-b'), inMinutes(2));
    expect(await db.consumePairToken(hash('token-b'))).toBe(userId);
    // The row is gone, so the replayed QR is worth nothing.
    expect(await db.consumePairToken(hash('token-b'))).toBeNull();
    const { rows } = await db.pool.query('SELECT * FROM pair_tokens');
    expect(rows).toHaveLength(0);
  });

  it('consuming deletes the row rather than marking it used', async () => {
    await db.createPairToken(userId, hash('token-c'), inMinutes(2));
    await db.consumePairToken(hash('token-c'));
    const { rows } = await db.pool.query('SELECT * FROM pair_tokens');
    expect(rows).toHaveLength(0);
  });

  it('refuses an expired token', async () => {
    // Already expired when written — the consume must not resurrect it.
    await db.createPairToken(userId, hash('token-old'), inMinutes(-1));
    expect(await db.consumePairToken(hash('token-old'))).toBeNull();
    // ...and the expired row is still there: expiry is enforced by the WHERE
    // clause, not by having been swept. That is what stops a token slipping
    // through between a sweep and a redeem.
    const { rows } = await db.pool.query('SELECT * FROM pair_tokens');
    expect(rows).toHaveLength(1);
  });

  it('refuses a token that was never minted', async () => {
    expect(await db.consumePairToken(hash('never-existed'))).toBeNull();
  });

  it('only one of two racing consumes of the same token wins', async () => {
    // The single-use guarantee is the DELETE, so hammer it concurrently: a
    // read-then-write implementation would hand a session to both callers.
    await db.createPairToken(userId, hash('token-race'), inMinutes(2));
    const results = await Promise.all(
      Array.from({ length: 8 }, () => db.consumePairToken(hash('token-race'))),
    );
    expect(results.filter((r) => r === userId)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(7);
  });

  it('sweeps expired tokens and leaves live ones alone', async () => {
    await db.createPairToken(userId, hash('expired-1'), inMinutes(-5));
    await db.createPairToken(userId, hash('expired-2'), inMinutes(-1));
    await db.createPairToken(userId, hash('live-1'), inMinutes(2));

    expect(await db.sweepExpiredPairTokens()).toBe(2);

    const { rows } = await db.pool.query<{ token_hash: string }>('SELECT token_hash FROM pair_tokens');
    expect(rows.map((r) => r.token_hash)).toEqual([hash('live-1')]);
    // The survivor is still redeemable after the sweep.
    expect(await db.consumePairToken(hash('live-1'))).toBe(userId);
  });

  it('rejects a duplicate token hash', async () => {
    // UNIQUE(token_hash) — two users must never share a code. With 32 bytes of
    // CSPRNG this cannot happen by chance; the constraint is here so that a
    // future bug in token generation fails loudly instead of silently letting
    // one QR sign in as the wrong person.
    await db.createPairToken(userId, hash('token-dup'), inMinutes(2));
    await expect(db.createPairToken(userId, hash('token-dup'), inMinutes(2))).rejects.toThrow();
  });

  it('cascades: deleting the user revokes their outstanding tokens', async () => {
    await db.createPairToken(userId, hash('token-cascade'), inMinutes(2));
    await db.deleteUser(userId);
    const { rows } = await db.pool.query('SELECT * FROM pair_tokens');
    expect(rows).toHaveLength(0);
    expect(await db.consumePairToken(hash('token-cascade'))).toBeNull();
  });

  it('binds each token to its own minting user', async () => {
    const other = await db.createUser('otheruser', 'not-a-real-hash', false);
    await db.createPairToken(userId, hash('token-user-1'), inMinutes(2));
    await db.createPairToken(other.id, hash('token-user-2'), inMinutes(2));

    expect(await db.consumePairToken(hash('token-user-1'))).toBe(userId);
    expect(await db.consumePairToken(hash('token-user-2'))).toBe(other.id);
  });
});
