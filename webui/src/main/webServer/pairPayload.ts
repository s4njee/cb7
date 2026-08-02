import type { NetworkInterfaceInfo } from 'node:os';

/**
 * @module
 * QR Pairing Payload Builder — the v1 wire format
 *
 * Architecture overview for Junior Devs:
 * The "Pair a device" panel renders a QR whose contents are one versioned
 * string, defined in `reader/docs/CONTRACT.md` § "QR pairing payload":
 *
 *     cb8pair://v1?url=<urlencoded origin>[&token=<opaque>]
 *
 * This module is the **producer**; the Shelf client's `src/lib/pair.ts`
 * (`parsePairPayload`) is the **consumer**. `pairPayload.test.ts` mirrors that
 * file's vector table — the two halves must not drift, so any change here needs
 * the matching change there.
 *
 * It also computes the **candidate origins** the panel offers (see
 * `pairOriginsForRequest`), which is what stops the panel from cheerfully
 * rendering a QR of `http://localhost:8008` that no phone on earth can reach.
 *
 * The module is pure (no I/O, no globals beyond `URL`/`URLSearchParams`) so both
 * the format and the address math are unit-testable without a server or a
 * browser — `os.networkInterfaces()` is passed in rather than called here.
 */

/** The only payload version this server emits. */
const VERSION = 'v1';

/**
 * Normalize an http(s) origin, or return `null` when the input is anything more
 * than an origin.
 *
 * Deliberately identical in behaviour to the client's `normalizeOrigin`: an
 * origin is scheme + host + optional port, with no path, query, fragment, or
 * credentials. `URL.origin` drops a default port, lowercases the host, and never
 * carries a trailing slash — exactly the normalization the contract specifies.
 *
 * @param value The candidate origin.
 * @returns The normalized origin, or `null` if it is not a bare http(s) origin.
 */
export function normalizePairOrigin(value: string | null | undefined): string | null {
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.search || parsed.hash) return null;
  if (parsed.pathname !== '' && parsed.pathname !== '/') return null;

  return parsed.origin;
}

/**
 * Build the v1 pairing payload encoded into the QR.
 *
 * The query is assembled with `URLSearchParams` rather than by hand so the
 * percent-encoding of the origin is the platform's, and so a token containing
 * `&`/`=` could never break out of its parameter. (Tokens are base64url in
 * practice, but the builder must not depend on that.)
 *
 * @param origin The server origin a phone should connect to — must be a bare
 *               http(s) origin (no path/query/credentials).
 * @param token Optional single-use pairing token (v2 one-tap sign-in). Omit for
 *              a v1 "address only" code.
 * @returns The `cb8pair://v1?…` string to encode into the QR.
 * @throws {TypeError} If `origin` is not a valid http(s) origin — a malformed
 *         address would render a QR that every client rejects as `bad-url`, so
 *         failing loudly at the call site beats shipping a dud code.
 */
export function buildPairPayload(origin: string, token?: string): string {
  const normalized = normalizePairOrigin(origin);
  if (!normalized) {
    throw new TypeError(`buildPairPayload: not a valid http(s) origin: ${JSON.stringify(origin)}`);
  }

  const params = new URLSearchParams({ url: normalized });
  if (token) params.set('token', token);

  return `cb8pair://${VERSION}?${params.toString()}`;
}

/**
 * Hostnames that only ever mean "this machine". A QR of one of these is useless
 * to a phone: it would resolve to the *phone*, not the server.
 *
 * `0.0.0.0` is a wildcard bind address rather than a destination, and belongs on
 * the list for the same reason.
 *
 * @param hostname The hostname to test (no port, no brackets).
 * @returns `true` when the hostname is loopback/wildcard.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '::' || host === '0.0.0.0') return true;
  // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
  return /^127\./.test(host);
}

/**
 * Split a `Host` header into hostname and optional port.
 *
 * Handles the bracketed IPv6 form (`[::1]:8008`), where a naive split on `:`
 * would mangle the address. `hostForUrl` keeps the brackets an IPv6 literal needs
 * to go back into a URL, while `hostname` is the bare form for host comparisons —
 * conflating the two yields `http://::1:8008`, which is not a URL at all.
 */
function splitHostHeader(
  hostHeader: string,
): { hostname: string; hostForUrl: string; port: string } | null {
  const host = hostHeader.trim();
  if (!host) return null;

  const ipv6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(host);
  if (ipv6) return { hostname: ipv6[1], hostForUrl: `[${ipv6[1]}]`, port: ipv6[2] ?? '' };

  const parts = host.split(':');
  if (parts.length > 2) return null; // bare IPv6 without brackets — not a valid Host
  return { hostname: parts[0], hostForUrl: parts[0], port: parts[1] ?? '' };
}

/**
 * Compute the origins the pair panel should offer a QR for, best first.
 *
 * **The localhost trap.** The panel's obvious move is to encode
 * `window.location.origin`, but an admin usually opens the web UI on the machine
 * running the server — so that origin is `http://localhost:8008`, and a phone
 * scanning it tries to reach *itself*. The fix is to offer the server's LAN
 * addresses instead, which only the server can enumerate.
 *
 * The **port and scheme come from the request**, not from config, and that is
 * deliberate: `BETTER_AUTH_URL` describes the server's own view of itself
 * (`:8008` inside the container), whereas the `Host` header records the address
 * the browser actually reached — which is the one that works after a Docker port
 * publish (`4218 -> 8008`) or a reverse proxy. We swap only the *hostname* for
 * each LAN interface and keep the port the caller demonstrably got through on.
 *
 * Ordering is the panel's default: routable origins first (the request's own
 * origin leads when it is already routable — it is proven to work), then LAN
 * interface addresses, then loopback last as a fallback so a same-machine
 * scanner (or a curious admin) can still see it.
 *
 * @param hostHeader The request `Host` header (e.g. `192.168.1.20:4218`).
 * @param proto The scheme the request arrived on — `http` or `https`.
 * @param networkInterfaces The machine's interfaces, from `os.networkInterfaces()`.
 * @returns De-duplicated origins, most-likely-reachable first. Possibly empty if
 *          the Host header is unusable and no interfaces are up.
 */
export function pairOriginsForRequest(
  hostHeader: string | undefined,
  proto: string,
  networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string[] {
  const scheme = proto === 'https' ? 'https' : 'http';
  const parsedHost = hostHeader ? splitHostHeader(hostHeader) : null;
  const port = parsedHost?.port ?? '';
  const suffix = port ? `:${port}` : '';

  const routable: string[] = [];
  const loopback: string[] = [];

  const push = (candidate: string): void => {
    const normalized = normalizePairOrigin(candidate);
    if (!normalized) return;
    const { hostname } = new URL(normalized);
    const bucket = isLoopbackHostname(hostname) ? loopback : routable;
    if (!bucket.includes(normalized)) bucket.push(normalized);
  };

  // The origin the browser actually used. When it is a real address (a LAN IP, a
  // .local name, a reverse-proxied domain) it is the single best candidate — it
  // is the only one we have positive evidence about.
  if (parsedHost) push(`${scheme}://${parsedHost.hostForUrl}${suffix}`);

  // Every non-internal IPv4 the box owns, on the port the request came in on.
  // IPv4 only, matching the mDNS contract: link-local IPv6 confuses more than it
  // helps, and a phone that can route IPv6 to this box can route IPv4 too.
  for (const list of Object.values(networkInterfaces)) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        push(`${scheme}://${iface.address}${suffix}`);
      }
    }
  }

  return [...routable, ...loopback];
}
