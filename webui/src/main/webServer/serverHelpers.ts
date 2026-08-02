import * as path from 'node:path';

/**
 * @module
 * Web Server Routing & Access-Control Helpers
 *
 * Architecture overview for Junior Devs:
 * This module holds the pure decision logic the web server leans on: where to
 * find the built SPA assets on disk, when to hand an `/api/auth/*` request off to
 * the Better Auth library, and whether an incoming API request is allowed for the
 * current user. Keeping these as standalone functions means the access rules can
 * be unit tested without spinning up an HTTP server.
 */

/** Auth endpoints this server implements itself (not delegated to Better Auth). */
const OWN_AUTH_ENDPOINTS = new Set([
  '/api/auth/session',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/register',
  '/api/auth/sign-up/email',
  '/api/auth/sign-up/username',
  // QR device pairing. Better Auth knows nothing about these; without the
  // entries here they would be delegated to it and 404.
  '/api/auth/pair-token',
  '/api/auth/pair',
]);

/** API endpoints reachable without an authenticated session. */
const PUBLIC_API_ENDPOINTS = new Set([
  '/api/auth/session',
  '/api/auth/login',
  // Redeeming a pairing code is how a device *gets* its session, so it cannot
  // require one. The single-use token is the credential; the endpoint is on the
  // login rate limiter (see server.ts) for the same reason /login is.
  '/api/auth/pair',
]);

/**
 * Build the absolute base URL (`proto://host`) used for links in a response body
 * (OPDS feeds, WebPub manifests).
 *
 * `Host` and `X-Forwarded-*` are client-controlled, so honoring the forwarded
 * headers blindly lets an attacker rewrite every link in the returned document to
 * a host of their choosing (Host-header injection). Forwarded values are only
 * trustworthy behind a reverse proxy that overwrites them, so they're ignored
 * unless `CB8_TRUST_PROXY_HEADERS=1` — mirroring the auth layer's proxy handling.
 * Without the flag we fall back to `http` and the direct `Host`.
 */
export function requestBaseUrl(
  host: string | undefined,
  forwardedHost: string | string[] | undefined,
  forwardedProto: string | string[] | undefined,
): string {
  const trustProxy = process.env.CB8_TRUST_PROXY_HEADERS === '1';
  const first = (v: string | string[] | undefined): string | undefined =>
    (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim() || undefined;
  const proto = (trustProxy ? first(forwardedProto) : undefined) ?? 'http';
  const resolvedHost = (trustProxy ? first(forwardedHost) : undefined) ?? host ?? 'localhost';
  return `${proto}://${resolvedHost}`;
}

/** Result of resolving where the SPA assets live, with diagnostics. */
export type StaticRootResolution = {
  root: string;
  candidates: string[];
  warnings: string[];
};

/**
 * Resolve the directory the built SPA assets are served from.
 * Honours an explicit override first (warning if it doesn't exist),
 *          otherwise probes a list of known build-output locations relative to the
 *          runtime dir and packaged resources. If none exist, returns the first
 *          candidate plus a warning so the API still works while the SPA 404s.
 * @param runtimeDir The directory the server is running from.
 * @param options Override path, packaged resources path, and an `exists` probe.
 * @returns The chosen root, the candidates considered, and any warnings.
 */
export function resolveStaticRoot(
  runtimeDir: string,
  options: {
    override?: string;
    resourcesPath?: string;
    exists: (candidate: string) => boolean;
  },
): StaticRootResolution {
  const override = options.override;
  if (override) {
    return {
      root: override,
      candidates: [override],
      warnings: options.exists(override)
        ? []
        : [`CB8_WEB_ROOT is set to "${override}" but that path does not exist; SPA assets will 404.`],
    };
  }

  const candidates = [
    path.join(runtimeDir, '../../dist/web'),
    path.join(runtimeDir, '../dist/web'),
    path.join(runtimeDir, '../../web'),
    path.join(runtimeDir, '../web'),
    path.join(options.resourcesPath ?? '', 'web'),
  ];

  const found = candidates.find(options.exists);
  if (found) return { root: found, candidates, warnings: [] };

  return {
    root: candidates[0],
    candidates,
    warnings: [
      'Renderer assets not found in any known location. The SPA will not be served ' +
      '(API still works). Run "pnpm build:renderer", or set CB8_WEB_ROOT. Checked:\n  ' +
      candidates.join('\n  '),
    ],
  };
}

/**
 * Decide whether an auth request should be delegated to Better Auth.
 * True for `/api/auth/*` paths that this server does not implement itself.
 * @param pathname The request path.
 * @returns `true` if the request should be handled by Better Auth.
 */
export function shouldDelegateToBetterAuth(pathname: string): boolean {
  return pathname.startsWith('/api/auth/') && !OWN_AUTH_ENDPOINTS.has(pathname);
}

/**
 * Decide whether an API request is permitted.
 * Authenticated users can access anything; otherwise only the public
 *          endpoints are allowed, plus read-only (`GET`) requests when guest
 *          access is enabled.
 * @param pathname The request path.
 * @param method The HTTP method.
 * @param currentUser The authenticated user, or a falsy value if none.
 * @param guestEnabled Whether unauthenticated read access is permitted.
 * @returns `true` if the request should be allowed.
 */
export function canAccessApiRequest(
  pathname: string,
  method: string,
  currentUser: unknown,
  guestEnabled: boolean,
): boolean {
  if (currentUser) return true;
  if (PUBLIC_API_ENDPOINTS.has(pathname)) return true;
  return guestEnabled && method === 'GET';
}
