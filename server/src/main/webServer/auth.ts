/**
 * @module
 * Authentication Setup (better-auth)
 *
 * Architecture overview for Junior Devs:
 * Login, sessions, and password verification are handled by the `better-auth`
 * library so we don't hand-roll auth. This file wires it to our existing
 * database and data model. Key decisions:
 *  - It reuses the same better-sqlite3 connection as its auth database.
 *  - It maps better-auth's default `user` model onto our plural `users` table.
 *  - IDs stay SQLite INTEGER AUTOINCREMENT so all tables that reference a user
 *    (user_progress, bookmarks, user_favorites, reading_history) keep working.
 *  - Passwords keep using bcryptjs, so legacy `password_hash` rows still verify
 *    after migration into the `account` table.
 *  - The username plugin allows logging in with username *or* email.
 */

import { betterAuth } from 'better-auth';
import { username as usernamePlugin } from 'better-auth/plugins';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import type { Pool } from 'pg';
import { sendEmail } from './emailSender';
import { createLogger } from '../logger';
import {
  authResetPasswordLink,
  diagnoseUntrustedOrigin,
  isUsableSecret,
  resolveAuthBaseURL,
  trustedOriginsForBaseURL,
  withSameHostOrigin,
} from './authHelpers';

const log = createLogger('auth');

/**
 * Whether to trust reverse-proxy forwarding headers (`X-Forwarded-Host` /
 * `X-Forwarded-Proto`) when computing same-origin trust. Off by default: these
 * headers are only trustworthy behind a proxy that overwrites them, and a
 * directly-exposed server must not honor client-supplied values. Set
 * `CB8_TRUST_PROXY_HEADERS=1` when CB8 sits behind a reverse proxy so the public
 * origin is trusted without enumerating it in BETTER_AUTH_TRUSTED_ORIGINS.
 */
function trustProxyHeaders(): boolean {
  return process.env.CB8_TRUST_PROXY_HEADERS === '1';
}

/**
 * Endpoint path (relative to better-auth's `/api/auth` base) of the internal
 * "establish a session for this user, no password" endpoint used by QR pairing.
 *
 * SECURITY — read before touching this:
 * This endpoint signs in as an arbitrary user id with no credential whatsoever.
 * It is safe *only* because it is unreachable over HTTP: the same constant is
 * passed to better-auth's `disabledPaths`, which makes the router answer 404
 * before the handler runs, while server-side `auth.api.*` calls (which do not go
 * through the router) still work. The two references must stay in lockstep — if
 * you rename the path in one place and not the other, you publish a
 * "log in as anyone" endpoint to the internet. Verified behaviour: a POST to
 * `/api/auth/pair/establish-session` answers 404 and sets no cookie. If you touch
 * either reference, re-verify that by hand.
 *
 * Note `metadata.SERVER_ONLY` is *not* sufficient on its own: in better-auth
 * 1.6.x it only hides the endpoint from the OpenAPI doc and the client's inferred
 * types. `disabledPaths` is what actually blocks the route.
 */
export const PAIR_SESSION_PATH = '/pair/establish-session';

/**
 * Session-bearing user, as returned by the pairing endpoint.
 * Mirrors the subset of better-auth's `User` the pair route echoes back.
 */
type PairSessionUser = {
  id: number | string;
  email: string;
  name: string;
  isAdmin?: boolean | null;
  username?: string | null;
};

/**
 * A private better-auth plugin exposing one server-only endpoint that mints the
 * standard session for a user *without* a password.
 *
 * Why a plugin rather than calling `internalAdapter.createSession` directly from
 * the route: creating the row is the easy half — the hard half is turning it into
 * the exact signed, prefixed, `SameSite`-correct cookie the rest of the app
 * already trusts. `setSessionCookie` does that, but it needs a real
 * `GenericEndpointContext`, which only exists inside a better-auth endpoint.
 * Registering an endpoint is the supported way to obtain one; the alternative
 * (hand-rolling the cookie's signing/attributes) would fork the cookie format and
 * silently drift from the library on every upgrade.
 *
 * The handler mirrors better-auth's own `signInEmail` tail (`dist/api/routes/
 * sign-in.mjs`): `createSession(userId, dontRememberMe = false)` then
 * `setSessionCookie(ctx, { session, user })`. That is what makes the resulting
 * session indistinguishable from a password sign-in — same 30-day sliding
 * expiry, same cookie, same `/api/auth/session` shape, same `logout` behaviour.
 */
function pairSessionPlugin() {
  return {
    id: 'cb8-pair-session',
    endpoints: {
      cb8EstablishPairSession: createAuthEndpoint(
        PAIR_SESSION_PATH,
        {
          method: 'POST',
          // Hides it from the OpenAPI doc / client types. The real guard is
          // `disabledPaths` below — see PAIR_SESSION_PATH.
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          // Validated by hand rather than with a zod body schema: zod is a
          // transitive dependency of better-auth, not a direct one, so importing
          // it here would be a phantom dependency that breaks under a stricter
          // node-linker. The input surface is one string from our own route.
          const userId = (ctx.body as { userId?: unknown } | undefined)?.userId;
          if (typeof userId !== 'string' || userId.length === 0) {
            throw new APIError('BAD_REQUEST', { message: 'userId is required' });
          }

          const user = await ctx.context.internalAdapter.findUserById(userId);
          if (!user) {
            // The bound user was deleted between minting and redeeming.
            throw new APIError('UNAUTHORIZED', { message: 'User not found' });
          }

          const session = await ctx.context.internalAdapter.createSession(String(user.id), false);
          if (!session) {
            throw new APIError('UNAUTHORIZED', { message: 'Failed to create session' });
          }

          await setSessionCookie(ctx, { session, user });
          return ctx.json({ user: user as unknown as PairSessionUser });
        },
      ),
    },
  };
}

// The full inferred type of `betterAuth(...)` depends on the exact options
// passed; caching it as the generic return type causes variance errors between
// the plugin-augmented user shape and the base `User`. Narrow publicly to the
// subset of the API we actually consume.
export type AuthUser = {
  id: number | string;
  email: string;
  name: string;
  isAdmin?: boolean | null;
  username?: string | null;
};

type AuthResponseWithHeaders<T> = {
  headers?: Headers | null;
  response: T;
};

type SignInResponse = {
  redirect: boolean;
  token: string;
  url?: string | null;
  user: AuthUser;
};

export interface AuthInstance {
  handler: (req: Request) => Promise<Response>;
  api: {
    getSession: (args: { headers: Headers }) => Promise<{
      user: AuthUser | null;
      session: unknown;
    } | null>;
    signInUsername: (args: {
      body: { username: string; password: string };
      headers?: Headers;
      returnHeaders: true;
    }) => Promise<AuthResponseWithHeaders<SignInResponse>>;
    signInEmail: (args: {
      body: { email: string; password: string };
      headers?: Headers;
      returnHeaders: true;
    }) => Promise<AuthResponseWithHeaders<SignInResponse>>;
    signOut: (args: { headers: Headers; returnHeaders: true }) => Promise<AuthResponseWithHeaders<{ success: boolean }>>;
    /**
     * Establish the standard session for `userId` with no password — the tail of
     * the QR pairing flow (`POST /api/auth/pair`). Server-only: reachable through
     * this `api` object, 404 over HTTP. See {@link PAIR_SESSION_PATH}.
     */
    cb8EstablishPairSession: (args: {
      body: { userId: string };
      headers?: Headers;
      returnHeaders: true;
    }) => Promise<AuthResponseWithHeaders<{ user: PairSessionUser }>>;
  };
}

let _auth: AuthInstance | null = null;

/**
 * Resolve the better-auth signing secret.
 *
 * Priority:
 *   1. BETTER_AUTH_SECRET environment variable (production / Docker deploys).
 *   2. A secret persisted in app_meta under the key 'auth_secret' (desktop /
 *      standalone runs). This keeps session cookies valid across restarts so
 *      the user does not have to log in again every time the app is restarted.
 *   3. Generate a new secret, persist it, and use it going forward.
 *
 * Using a persistent secret means better-auth's signed session cookies remain
 * valid after a restart. With an ephemeral (random) secret every restart
 * invalidated all existing sessions, forcing manual re-authentication.
 */
async function resolveSecret(pool: Pool): Promise<string> {
  const fromEnv = process.env.BETTER_AUTH_SECRET;
  if (isUsableSecret(fromEnv)) return fromEnv;

  const AUTH_SECRET_KEY = 'auth_secret';
  const result = await pool.query<{ value: string }>('SELECT value FROM app_meta WHERE key = $1', [AUTH_SECRET_KEY]);
  const stored = result.rows[0]?.value;
  if (isUsableSecret(stored)) return stored;

  // Generate a new secret, persist it so the next restart reuses it.
  const newSecret = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [AUTH_SECRET_KEY, newSecret],
  );
  return newSecret;
}

function resolveBaseURL(): string {
  return resolveAuthBaseURL(process.env.BETTER_AUTH_URL);
}

/**
 * Origins better-auth will accept. Includes the configured BASE_URL plus
 * common loopback aliases and, if the web server is listening on a port,
 * the current LAN IP. Without this, users hitting 127.0.0.1 or their LAN
 * address instead of `localhost` are rejected with a 500.
 */
function resolveTrustedOrigins(): string[] {
  return trustedOriginsForBaseURL(
    resolveBaseURL(),
    os.networkInterfaces(),
    process.env.BETTER_AUTH_TRUSTED_ORIGINS,
  );
}

export async function createAuth(pool: Pool): Promise<AuthInstance> {
  if (_auth) return _auth;
  const secret = await resolveSecret(pool);
  _auth = buildAuth(pool, secret) as unknown as AuthInstance;
  return _auth;
}

/**
 * Exported for tests only: constructing the instance is pure (no DB round-trip
 * until a request runs), so a test can assert on the options we hand
 * better-auth — specifically that {@link PAIR_SESSION_PATH} is disabled over
 * HTTP. Production goes through {@link createAuth}, which also resolves the
 * persisted secret.
 */
/**
 * What {@link buildAuth} returns. Narrowed from better-auth's full instance to
 * the shape this codebase relies on (`AuthInstance` plus the `options` that
 * tests assert on), because the raw inferred type drags in an unnameable
 * `zod/v4/core` reference (better-auth re-exports zod) and trips TS2742. The
 * instance is not structurally assignable to this shape either — its endpoint
 * types differ — so {@link buildAuth} casts, mirroring {@link createAuth}.
 */
export type BuildAuthResult = AuthInstance & {
  options: Parameters<typeof betterAuth>[0];
};

export function buildAuth(database: Pool, secret: string): BuildAuthResult {
  return betterAuth({
    database,
    secret,
    baseURL: resolveBaseURL(),
    telemetry: {
      enabled: false,
    },
    advanced: {
      database: { generateId: false },
      cookiePrefix: 'cb8',
    },
    // Keep the pairing session-minter off the network. The router 404s these
    // paths in `onRequest`, before the handler runs, while `auth.api.*` calls
    // bypass the router entirely and still reach it. This is the *only* thing
    // standing between the internet and a "sign in as any user id" endpoint —
    // see PAIR_SESSION_PATH.
    disabledPaths: [PAIR_SESSION_PATH],
    // Our SQLite schema uses snake_case columns (user_id, expires_at, …)
    // but better-auth's default adapter issues queries with camelCase field
    // names verbatim. Without these mappings, every session / account
    // insert errors with "no such column: userId" and the sign-in path
    // returns a silent 500 from FAILED_TO_CREATE_SESSION.
    user: {
      modelName: 'users',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        // `displayUsername` is added by the username plugin; cast widens
        // the record so TS doesn't complain about the plugin field.
        displayUsername: 'display_username',
      } as Record<string, string>,
      additionalFields: {
        isAdmin: {
          type: 'boolean',
          required: false,
          defaultValue: false,
          input: false,
          fieldName: 'is_admin',
        },
      },
    },
    // Keep sessions alive for 30 days with a sliding window (cookie is
    // refreshed on each access after 1 day of inactivity). This prevents
    // the "must re-login every week" problem on desktop where the app may
    // not be opened daily. The persistent auth_secret (above) ensures
    // the signed session cookie stays valid across server restarts.
    session: {
      expiresIn: 60 * 60 * 24 * 30,  // 30 days
      updateAge:  60 * 60 * 24,       // refresh cookie if older than 1 day
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      password: {
        hash: (password) => bcrypt.hash(password, 10),
        verify: ({ hash, password }) => bcrypt.compare(password, hash),
      },
      sendResetPassword: async ({ user, token }) => {
        // Bypass better-auth's server-side redirect in favor of an SPA route
        // that renders the new-password form and calls /reset-password itself.
        const link = authResetPasswordLink(resolveBaseURL(), token);
        await sendEmail({
          to: user.email,
          subject: 'Reset your CB8 password',
          text: `Click to reset your password: ${link}\n\nIf you did not request this, you can ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      // After verifying, better-auth redirects to this URL (clients may
      // override via callbackURL on the sign-up request).
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: 'Verify your CB8 email',
          text: `Welcome to CB8! Click to verify your email: ${url}`,
        });
      },
    },
    plugins: [
      usernamePlugin({
        minUsernameLength: 3,
        maxUsernameLength: 30,
      }),
      pairSessionPlugin(),
    ],
    // Per-request trusted origins: always include the configured static set,
    // and additionally trust the Origin header when it points at the same
    // host as the incoming request (i.e. the SPA we just served). Behind a
    // reverse proxy (CB8_TRUST_PROXY_HEADERS=1) the forwarded host/proto are
    // also honored, so NodePort/LoadBalancer/Ingress/proxy deploys work without
    // curating every possible host:port pair in env vars.
    trustedOrigins: (request) => {
      const origin = request?.headers.get('origin');
      const proxied = trustProxyHeaders();
      const trusted = withSameHostOrigin(
        resolveTrustedOrigins(),
        origin,
        request?.headers.get('host'),
        proxied ? request?.headers.get('x-forwarded-host') : null,
        proxied ? request?.headers.get('x-forwarded-proto') : null,
      );
      // Turn the silent "cross-site" rejection into an actionable log line.
      const problem = diagnoseUntrustedOrigin(trusted, origin);
      if (problem) log.warn(problem);
      return trusted;
    },
  }) as unknown as BuildAuthResult;
}

export function getAuth(): AuthInstance {
  if (!_auth) throw new Error('auth not initialized — call createAuth(db) first');
  return _auth;
}
