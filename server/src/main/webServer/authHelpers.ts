import type { NetworkInterfaceInfo } from 'node:os';

/**
 * @module
 * Auth URL & Trusted-Origin Helpers
 *
 * Architecture overview for Junior Devs:
 * The auth layer needs to know its own base URL (for building links like the
 * password-reset email) and which origins it should trust for CSRF/CORS purposes.
 * Because the app can be reached over localhost, loopback, or a LAN IP on the
 * same port, the trusted-origin list has to be computed from the machine's network
 * interfaces at runtime. These pure functions do that math without touching the
 * live server, so the (security-relevant) rules are easy to test.
 */

/** Fallback base URL when none is configured via the environment. */
export const DEFAULT_AUTH_BASE_URL = 'http://localhost:8008';

/**
 * Resolve the auth base URL, falling back to the default.
 * @param envValue The configured value from the environment, if any.
 * @returns The configured URL, or `DEFAULT_AUTH_BASE_URL` when unset.
 */
export function resolveAuthBaseURL(envValue: string | undefined): string {
  return envValue || DEFAULT_AUTH_BASE_URL;
}

/**
 * Build the front-end password-reset link for a given token.
 * @param baseURL The app base URL.
 * @param token The reset token (URL-encoded into the link).
 * @returns The full reset-password URL.
 */
export function authResetPasswordLink(baseURL: string, token: string): string {
  return `${baseURL}/#/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Parse a comma-separated list of extra trusted origins.
 * @param raw The raw env value, if any.
 * @returns Trimmed, non-empty origin strings (empty array when unset).
 */
export function parseTrustedOriginExtras(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Compute the full set of trusted origins for the configured base URL.
 * Starts from the base URL, adds the standard loopback hosts on the same
 *          port, then every non-internal IPv4 LAN address (so the app works when
 *          reached from another device), and finally any explicitly configured
 *          extras. An unparseable base URL is kept as-is.
 * @param baseURL The app base URL.
 * @param networkInterfaces The machine's network interfaces (from `os.networkInterfaces()`).
 * @param extraOrigins Comma-separated extra origins from configuration, if any.
 * @returns A de-duplicated list of trusted origins.
 */
export function trustedOriginsForBaseURL(
  baseURL: string,
  networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  extraOrigins: string | undefined,
): string[] {
  const out = new Set<string>([baseURL]);
  try {
    const parsed = new URL(baseURL);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    for (const host of ['localhost', '127.0.0.1', '0.0.0.0', '[::1]']) {
      out.add(`${parsed.protocol}//${host}:${port}`);
    }
    for (const list of Object.values(networkInterfaces)) {
      for (const iface of list ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          out.add(`${parsed.protocol}//${iface.address}:${port}`);
        }
      }
    }
  } catch {
    // Keep the configured base URL even if it is not parseable.
  }

  for (const origin of parseTrustedOriginExtras(extraOrigins)) {
    out.add(origin);
  }
  return Array.from(out);
}

/** First value of a (possibly comma-separated) forwarded header, trimmed. */
function firstForwardedValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(',')[0]?.trim();
  return first || null;
}

/**
 * Conditionally trust a request's Origin when it matches the host the request
 * was actually served on.
 *
 * Lets a request through when its `Origin` refers to the same host as either the
 * direct `Host` header *or* a proxy-forwarded host (`X-Forwarded-Host`). A
 * matching Origin is same-origin and therefore safe to trust without curating
 * every `host:port` in config — this covers dynamic LAN access (by IP or
 * `.local` name) and reverse-proxy deploys not known at startup.
 *
 * Security note: a same-host match is safe because a browser sets `Host` to the
 * real target it is talking to and `Origin` to the page that issued the request;
 * a cross-site attacker cannot make the two agree. The forwarded host/proto, by
 * contrast, are only trustworthy behind a proxy that overwrites them, so the
 * caller must pass `null` for them unless proxy headers are explicitly trusted.
 *
 * @param trustedOrigins The base trusted-origin list.
 * @param origin The request `Origin` header, if present.
 * @param host The request `Host` header, if present.
 * @param forwardedHost The request `X-Forwarded-Host`, if proxy headers are trusted.
 * @param forwardedProto The request `X-Forwarded-Proto`, if proxy headers are trusted.
 * @returns The trusted-origin list, possibly extended with the request/forwarded origin.
 */
export function withSameHostOrigin(
  trustedOrigins: string[],
  origin: string | null | undefined,
  host: string | null | undefined,
  forwardedHost?: string | null,
  forwardedProto?: string | null,
): string[] {
  const out = new Set<string>(trustedOrigins);

  const fwdHost = firstForwardedValue(forwardedHost);
  const fwdProto = firstForwardedValue(forwardedProto);

  // Hosts that count as "the same site we just served".
  const sameSiteHosts = new Set<string>();
  if (host) sameSiteHosts.add(host);
  if (fwdHost) sameSiteHosts.add(fwdHost);

  try {
    if (origin) {
      const parsed = new URL(origin);
      if (sameSiteHosts.has(parsed.host)) out.add(origin);
    }
  } catch {
    // Ignore invalid Origin headers.
  }

  // Behind a proxy the browser's Origin is the public URL while Host is the
  // internal upstream; reconstruct the public origin from the forwarded headers
  // so it is trusted even when it never matches the internal Host.
  if (fwdHost && fwdProto) {
    out.add(`${fwdProto}://${fwdHost}`);
  }

  return Array.from(out);
}

/**
 * Explain why a login origin will be rejected, for self-diagnosing logs.
 *
 * Returns a human-readable message when `origin` is present but not in the
 * computed trusted set (so better-auth will reject the sign-in as cross-site),
 * or `null` when the origin is absent or already trusted. Purely advisory — it
 * never changes what is trusted.
 *
 * @param trustedOrigins The fully computed trusted-origin list for the request.
 * @param origin The request `Origin` header, if present.
 * @returns An actionable message, or `null` when there is nothing to warn about.
 */
export function diagnoseUntrustedOrigin(
  trustedOrigins: string[],
  origin: string | null | undefined,
): string | null {
  if (!origin) return null;
  if (trustedOrigins.includes(origin)) return null;
  return (
    `Login from origin "${origin}" is not trusted and will be rejected as ` +
    `cross-site. If you reach CB8 at this address, add it to ` +
    `BETTER_AUTH_TRUSTED_ORIGINS (comma-separated) and restart. ` +
    `Currently trusted: ${trustedOrigins.join(', ')}`
  );
}

/**
 * Whether a configured/stored secret is usable (long enough to sign sessions).
 * Centralizes the "at least 32 chars" rule so the env-over-stored precedence is
 * testable without a live database.
 * @param value The candidate secret, if any.
 * @returns `true` when the value is present and at least 32 characters.
 */
export function isUsableSecret(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length >= 32;
}
