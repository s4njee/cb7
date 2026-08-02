import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { fromNodeHeaders } from 'better-auth/node';
import {
  GUEST_ACCESS_KEY,
  sendJson, sendError,
  isHostConnection,
  invalidateGuestAccessCache,
} from '../middleware';
import { getAuth } from '../auth';
import { requireAdmin, type RouteHandler } from '../context';
import type { InitialCredentialsResponse, PairInfoResponse, PairTokenResponse } from '../../../shared/apiTypes';
import { pairOriginsForRequest } from '../pairPayload';
import { readJsonBody, requireCurrentUser, requireString, requireTrimmedString } from './validation';
const AUTO_RESCAN_INTERVAL_KEY = 'auto_rescan_interval_min';

/**
 * @module
 * HTTP Route Handlers for Authentication and First-Run Setup
 *
 * Architecture overview for Junior Devs:
 * Serves the `/api/auth/*` and related endpoints that the SPA uses for the login
 * lifecycle: reporting session status, the initial-admin bootstrap, changing the
 * admin password, and toggling guest access. The heavy lifting of verifying
 * credentials and managing sessions is done by the `better-auth` instance
 * (`../auth`); this handler covers the pieces we own or expose ourselves.
 *
 * Like all route modules, the single exported `handle` is a `RouteHandler`: it
 * inspects `method`/`pathname`, serves the request via `sendJson`/`sendError`,
 * and returns `true` once it has claimed the request (or `false` to pass).
 *
 * This module also implements **QR device pairing** (`/api/auth/pair-token`,
 * `/api/auth/pair`, `/api/settings/pair-info`) — see the block comment above
 * those handlers, and `reader/docs/CONTRACT.md` § "Pair tokens".
 */

/**
 * How long a freshly minted pairing token stays redeemable.
 *
 * A pairing QR is a **bearer secret while valid**: anyone who can see the screen
 * can sign in as the minting user. The TTL therefore *is* the shoulder-surf
 * window, and 120 s (per the contract) is the compromise between "long enough to
 * fish your phone out and scan" and "a photo of the screen is worthless by the
 * time the attacker walks away". The panel re-mints well inside this window so a
 * stale screenshot never redeems.
 */
const PAIR_TOKEN_TTL_MS = 120_000;

/** Entropy per pairing token. 32 bytes of CSPRNG is unguessable within any TTL. */
const PAIR_TOKEN_BYTES = 32;

/**
 * The single failure message for every `/api/auth/pair` rejection.
 *
 * Bad token, expired token, already-used token, and deleted-user all produce
 * *this exact string with this exact status*. Distinguishing them would turn the
 * endpoint into an oracle: "expired" vs "invalid" tells an attacker a guess hit a
 * real token and only just missed, which is precisely the signal that makes
 * brute-forcing worthwhile.
 */
const PAIR_FAILURE_MESSAGE = 'Invalid or expired pairing code';

/** Hash a pairing token for storage/lookup: sha256, lowercase hex. */
function hashPairToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, currentUser, guestEnabled } = ctx;

  // Session status
  if (method === 'GET' && pathname === '/api/auth/session') {
    sendJson(res, 200, {
      authenticated: currentUser !== null,
      user: currentUser,
      host: isHostConnection(req),
      guestAccess: guestEnabled,
    });
    return true;
  }

  // Login — delegate credential verification and session creation to better-auth.
  if (method === 'POST' && pathname === '/api/auth/login') {
    const parsed = await readJsonBody<{ username?: string; password?: string }>(req, res);
    if (!parsed.ok) return true;
    const password = requireString(res, parsed.value.password, 'password');
    if (!password) return true;
    const username = typeof parsed.value.username === 'string' && parsed.value.username ? parsed.value.username : 'admin';
    try {
      const result = await getAuth().api.signInUsername({
        body: { username, password },
        headers: fromNodeHeaders(req.headers),
        returnHeaders: true,
      });
      const cookies = result.headers?.getSetCookie?.() ?? [];
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
      const user = result.response.user;
      sendJson(res, 200, {
        ok: true,
        user: { id: user.id, username: user.username ?? user.name, isAdmin: user.isAdmin === true },
      });
    } catch {
      sendError(res, 401, 'Invalid credentials');
    }
    return true;
  }

  // ---------------------------------------------------------------- QR pairing
  //
  // Flow: the signed-in web UI mints a token (`/api/auth/pair-token`) and renders
  // it into a QR; a phone scans it and POSTs the token to `/api/auth/pair`, which
  // consumes it and hands back the standard session cookie. See
  // reader/docs/CONTRACT.md § "Pair tokens (QR v2 — auth surface)".
  //
  // Security properties this code is responsible for:
  //  - the plaintext token exists in exactly one place: the pair-token response
  //    body. Never a log line, never app_meta, never the pair_tokens table;
  //  - single-use and expiry are enforced by one atomic SQL DELETE (see
  //    db/pairTokens.ts) — not by a check-then-act in JS;
  //  - every failure mode of `/api/auth/pair` is indistinguishable to the caller;
  //  - guests cannot mint (a guest has no user to bind a token to).

  // Mint a pairing token — signed-in users only.
  if (method === 'POST' && pathname === '/api/auth/pair-token') {
    // requireCurrentUser 401s guests and anonymous callers. Guest mode grants
    // read-only *browsing*, never an identity, so there is nothing to pair to.
    const user = requireCurrentUser(ctx);
    if (!user) return true;

    // Opportunistic housekeeping: pairing is rare and bursty, so sweeping here
    // keeps the table small without a background job.
    await db.sweepExpiredPairTokens();

    const token = crypto.randomBytes(PAIR_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + PAIR_TOKEN_TTL_MS);
    // Only the hash is persisted — a DB dump yields nothing redeemable.
    await db.createPairToken(user.id, hashPairToken(token), expiresAt);

    // This response body is the one and only place the plaintext appears.
    const body: PairTokenResponse = { token, expiresAt: expiresAt.toISOString() };
    sendJson(res, 200, body);
    return true;
  }

  // Redeem a pairing token — deliberately anonymous: the whole point is that the
  // phone has no session yet.
  if (method === 'POST' && pathname === '/api/auth/pair') {
    const parsed = await readJsonBody<{ token?: unknown }>(req, res);
    if (!parsed.ok) return true;
    const token = parsed.value.token;
    if (typeof token !== 'string' || token.length === 0) {
      // Same message as every other failure: a malformed body must not be
      // distinguishable from a wrong token.
      sendError(res, 401, PAIR_FAILURE_MESSAGE);
      return true;
    }

    // Constant-time compare, by construction: we hash the presented token and
    // look the *hash* up in a UNIQUE index. There is no byte-by-byte comparison
    // of a secret in JS to leak timing, and unlike `timingSafeEqual` this also
    // never has the real token in memory to compare against. The DB probe is the
    // compare — and the same statement enforces single-use and expiry atomically.
    const userId = await db.consumePairToken(hashPairToken(token));
    if (userId === null) {
      sendError(res, 401, PAIR_FAILURE_MESSAGE);
      return true;
    }

    try {
      // Establish the *standard* session — same cookie, same 30-day sliding
      // expiry, same logout path as a password sign-in. This is better-auth's own
      // session-creation code reached through a server-only endpoint; see
      // PAIR_SESSION_PATH in ../auth.ts for why it cannot be called over HTTP.
      const result = await getAuth().api.cb8EstablishPairSession({
        body: { userId: String(userId) },
        headers: fromNodeHeaders(req.headers),
        returnHeaders: true,
      });
      const cookies = result.headers?.getSetCookie?.() ?? [];
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
      const user = result.response.user;
      sendJson(res, 200, {
        ok: true,
        user: { id: user.id, username: user.username ?? user.name, isAdmin: user.isAdmin === true },
      });
    } catch {
      // The token was valid and is now spent (the DELETE already committed), but
      // the session could not be created — e.g. the bound user was deleted
      // between minting and redeeming. Fail closed with the same opaque message;
      // burning the token on an error is the right call, since we cannot tell an
      // infrastructure blip from an attacker probing a deleted account.
      sendError(res, 401, PAIR_FAILURE_MESSAGE);
    }
    return true;
  }

  // Addresses the pair panel can offer a QR for. Signed-in only (same audience as
  // the panel). Leaks no secret: LAN IPs of the box the caller is already talking
  // to. See pairOriginsForRequest for the localhost trap this exists to solve.
  if (method === 'GET' && pathname === '/api/settings/pair-info') {
    const user = requireCurrentUser(ctx);
    if (!user) return true;
    // Scheme/port come from the request, so a Docker port publish or a proxy is
    // reflected automatically. `x-forwarded-proto` is only honoured when the
    // operator has declared a proxy — mirroring the auth layer's rule — because
    // it is client-controlled otherwise.
    const proto = process.env.CB8_TRUST_PROXY_HEADERS === '1'
      ? String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http'
      : 'http';
    const body: PairInfoResponse = {
      origins: pairOriginsForRequest(req.headers.host, proto, os.networkInterfaces()),
    };
    sendJson(res, 200, body);
    return true;
  }

  // Register (admin only)
  if (method === 'POST' && pathname === '/api/auth/register') {
    if (!requireAdmin(ctx)) return true;
    const parsed = await readJsonBody<{ username?: string; password?: string; isAdmin?: boolean }>(req, res);
    if (!parsed.ok) return true;
    const username = requireTrimmedString(res, parsed.value.username, 'username');
    if (!username) return true;
    const password = requireString(res, parsed.value.password, 'password');
    if (!password) return true;
    if (await db.getUserByUsername(username)) { sendError(res, 409, 'Username already exists'); return true; }
    const hash = await bcrypt.hash(password, 10);
    const user = await db.createUser(username, hash, parsed.value.isAdmin === true);
    await db.upsertCredentialAccount(user.id, username, hash);
    sendJson(res, 201, user);
    return true;
  }

  // Public signup is disabled for public demos. Admin-created accounts use
  // /api/users or /api/auth/register after an admin session is established.
  if (method === 'POST' && (pathname === '/api/auth/sign-up/email' || pathname === '/api/auth/sign-up/username')) {
    sendError(res, 403, 'Public signup is disabled');
    return true;
  }

  // Logout — let better-auth clear its own session cookie.
  if (method === 'POST' && pathname === '/api/auth/logout') {
    try {
      const result = await getAuth().api.signOut({
        headers: fromNodeHeaders(req.headers),
        returnHeaders: true,
      });
      const cookies = result.headers?.getSetCookie?.() ?? [];
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
    } catch {
      // best-effort; always succeed
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Initial credentials are admin-only; public demos must not disclose the
  // first-run admin password over HTTP.
  if (method === 'GET' && pathname === '/api/settings/initial-credentials') {
    if (!requireAdmin(ctx)) return true;
    const password = (await db.getAppMeta('initial_password')) || null;
    const body: InitialCredentialsResponse = { username: 'admin', password };
    sendJson(res, 200, body);
    return true;
  }

  // Clear initial password (admin only — called after the admin has set a real password)
  if (method === 'DELETE' && pathname === '/api/settings/initial-credentials') {
    if (!requireAdmin(ctx)) return true;
    await db.setAppMeta('initial_password', '');
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Settings: guest access toggle (admin only)
  if (method === 'PUT' && pathname === '/api/settings/guest-access') {
    if (!requireAdmin(ctx)) return true;
    const parsed = await readJsonBody<{ enabled?: boolean }>(req, res);
    if (!parsed.ok) return true;
    const enabled = parsed.value.enabled === true;
    await db.setAppMeta(GUEST_ACCESS_KEY, enabled ? 'true' : 'false');
    invalidateGuestAccessCache(db);
    sendJson(res, 200, { ok: true, enabled });
    return true;
  }

  // Settings: auto-rescan interval
  if (method === 'GET' && pathname === '/api/settings/auto-rescan-interval') {
    const raw = await db.getAppMeta(AUTO_RESCAN_INTERVAL_KEY);
    const minutes = raw ? parseInt(raw, 10) : 0;
    sendJson(res, 200, { minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 0 });
    return true;
  }

  if (method === 'PUT' && pathname === '/api/settings/auto-rescan-interval') {
    if (!requireAdmin(ctx)) return true;
    const parsed = await readJsonBody<{ minutes?: number }>(req, res);
    if (!parsed.ok) return true;
    const minutes = typeof parsed.value.minutes === 'number' ? Math.max(0, Math.round(parsed.value.minutes)) : 0;
    await db.setAppMeta(AUTO_RESCAN_INTERVAL_KEY, String(minutes));
    sendJson(res, 200, { ok: true, minutes });
    return true;
  }

  return false;
};
