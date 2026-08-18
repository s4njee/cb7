/**
 * Regression guard for the pairing sign-in endpoint.
 *
 * `cb8EstablishPairSession` creates a session for an arbitrary user id with no
 * credential — it is the mechanism behind `POST /api/auth/pair`, and it is safe
 * *only* because better-auth's router answers 404 for it while `auth.api.*`
 * still reaches it internally. That guarantee rests entirely on
 * `disabledPaths` containing PAIR_SESSION_PATH.
 *
 * If someone renames the endpoint path, drops the `disabledPaths` entry, or
 * "cleans up" what looks like dead config, the result is a public
 * "sign in as any user" endpoint with no test failing. Hence this file: the
 * options object is built without touching Postgres, so the invariant is cheap
 * to pin.
 */
import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { buildAuth, PAIR_SESSION_PATH } from './auth';

/**
 * betterAuth() kicks off adapter initialization as a side effect, so a bare
 * `{}` leaves an unhandled rejection floating in the suite. A stub that answers
 * queries with empty rows keeps that init quiet — nothing here reads the
 * result, we only inspect the options object.
 */
const FAKE_POOL = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  }),
  end: async () => {},
  on: () => {},
} as unknown as Pool;
const SECRET = 'test-secret-not-used-for-signing-anything-real';

describe('pairing session endpoint guard', () => {
  it('disables the pair-session path over HTTP', () => {
    const auth = buildAuth(FAKE_POOL, SECRET);
    const disabled = (auth.options as { disabledPaths?: string[] }).disabledPaths ?? [];

    expect(disabled).toContain(PAIR_SESSION_PATH);
  });

  it('keeps the endpoint reachable in-process for /api/auth/pair to use', () => {
    const auth = buildAuth(FAKE_POOL, SECRET);

    // The whole design: 404 on the wire, callable from our own route handler.
    expect(typeof (auth.api as Record<string, unknown>).cb8EstablishPairSession).toBe('function');
  });

  it('pins the path itself, so a rename must be deliberate', () => {
    // Not redundant with the first test: that one would still pass if the path
    // were renamed in both places — but the comments, the route wiring and the
    // security review all talk about *this* string.
    expect(PAIR_SESSION_PATH).toBe('/pair/establish-session');
  });
});
