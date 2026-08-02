import { describe, expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import {
  buildPairPayload,
  isLoopbackHostname,
  normalizePairOrigin,
  pairOriginsForRequest,
} from './pairPayload';

/**
 * Vectors for the QR pairing payload producer.
 *
 * **These mirror the Shelf client's `reader/src/lib/pair.test.ts`** — both are
 * written from `reader/docs/CONTRACT.md` § "QR pairing payload" and must not
 * drift. The cases below cover the same ground as the client's accepted-payload
 * table (plain origin, origin with port, token present, urlencoding, https,
 * trailing slash, default port) so that every string this builder emits is one
 * the client's `parsePairPayload` accepts and round-trips.
 *
 * The client's reject cases (`not-shelf` / `bad-version` / `bad-url`) have no
 * producer-side mirror — this builder can't emit a wrong scheme or version — so
 * they show up here as the inputs `buildPairPayload` refuses to build from.
 */

describe('buildPairPayload', () => {
  it('builds a plain origin payload', () => {
    // Mirrors client vector "valid plain (unencoded url param)". The client
    // accepts both encoded and unencoded forms; we always emit encoded.
    expect(buildPairPayload('http://shelf.local')).toBe(
      'cb8pair://v1?url=http%3A%2F%2Fshelf.local',
    );
  });

  it('builds an origin with a port', () => {
    // Mirrors client vector "valid with port" / "urlencoded url".
    expect(buildPairPayload('http://192.168.1.20:8008')).toBe(
      'cb8pair://v1?url=http%3A%2F%2F192.168.1.20%3A8008',
    );
  });

  it('appends the token when one is given', () => {
    // Mirrors client vector "valid with token".
    expect(buildPairPayload('http://192.168.1.20:8008', 'aGVsbG8td29ybGQ')).toBe(
      'cb8pair://v1?url=http%3A%2F%2F192.168.1.20%3A8008&token=aGVsbG8td29ybGQ',
    );
  });

  it('omits the token param entirely for a v1 address-only code', () => {
    expect(buildPairPayload('http://shelf.local')).not.toContain('token');
    // An empty-string token is "no token", not a token of length zero — the
    // client would otherwise try to redeem "" and get a 401 for its trouble.
    expect(buildPairPayload('http://shelf.local', '')).toBe(
      'cb8pair://v1?url=http%3A%2F%2Fshelf.local',
    );
  });

  it('builds an https origin', () => {
    // Mirrors client vector "https origin".
    expect(buildPairPayload('https://books.example.com')).toBe(
      'cb8pair://v1?url=https%3A%2F%2Fbooks.example.com',
    );
  });

  it('normalizes a trailing slash away', () => {
    // Mirrors client vector "trailing slash is normalized away".
    expect(buildPairPayload('http://192.168.1.20:8008/')).toBe(
      'cb8pair://v1?url=http%3A%2F%2F192.168.1.20%3A8008',
    );
  });

  it('drops a default port', () => {
    // Mirrors client vector "default port is dropped by origin normalization".
    expect(buildPairPayload('https://books.example.com:443')).toBe(
      'cb8pair://v1?url=https%3A%2F%2Fbooks.example.com',
    );
    expect(buildPairPayload('http://shelf.local:80')).toBe(
      'cb8pair://v1?url=http%3A%2F%2Fshelf.local',
    );
  });

  it('lowercases the host', () => {
    expect(buildPairPayload('http://Shelf.Local:8008')).toBe(
      'cb8pair://v1?url=http%3A%2F%2Fshelf.local%3A8008',
    );
  });

  it('percent-encodes a token so it cannot break out of its parameter', () => {
    // Tokens are base64url in practice (no & or =), but the builder must not
    // depend on that: a token carrying separators must stay one parameter.
    const payload = buildPairPayload('http://shelf.local', 'a&url=evil.example.com');
    expect(payload).toBe(
      'cb8pair://v1?url=http%3A%2F%2Fshelf.local&token=a%26url%3Devil.example.com',
    );
    // Parsed back, `url` is still ours — the injected pair never materializes.
    const query = new URLSearchParams(payload.slice('cb8pair://v1?'.length));
    expect(query.get('url')).toBe('http://shelf.local');
    expect(query.get('token')).toBe('a&url=evil.example.com');
  });

  it('leaves base64url token characters unescaped', () => {
    // `-` and `_` are base64url's alphabet; they must survive verbatim so the
    // token the client redeems is byte-identical to the one we minted.
    const payload = buildPairPayload('http://shelf.local', 'aA0-_zZ9');
    expect(payload).toBe('cb8pair://v1?url=http%3A%2F%2Fshelf.local&token=aA0-_zZ9');
  });

  it('refuses anything that is not a bare http(s) origin', () => {
    // The mirror of the client's `bad-url` rejects: if the client would refuse
    // to parse it, we must refuse to render a QR of it.
    expect(() => buildPairPayload('http://shelf.local/api')).toThrow(TypeError);
    expect(() => buildPairPayload('http://user:pass@shelf.local')).toThrow(TypeError);
    expect(() => buildPairPayload('http://shelf.local?x=1')).toThrow(TypeError);
    expect(() => buildPairPayload('http://shelf.local#frag')).toThrow(TypeError);
    expect(() => buildPairPayload('ftp://shelf.local')).toThrow(TypeError);
    expect(() => buildPairPayload('192.168.1.20')).toThrow(TypeError);
    expect(() => buildPairPayload('')).toThrow(TypeError);
  });
});

describe('normalizePairOrigin', () => {
  it('accepts bare http(s) origins and normalizes them', () => {
    expect(normalizePairOrigin('http://shelf.local')).toBe('http://shelf.local');
    expect(normalizePairOrigin('http://shelf.local/')).toBe('http://shelf.local');
    expect(normalizePairOrigin('  http://shelf.local  ')).toBe('http://shelf.local');
    expect(normalizePairOrigin('https://books.example.com:8443')).toBe('https://books.example.com:8443');
    expect(normalizePairOrigin('http://192.168.1.20:8008')).toBe('http://192.168.1.20:8008');
  });

  it('rejects non-origins', () => {
    expect(normalizePairOrigin(null)).toBeNull();
    expect(normalizePairOrigin(undefined)).toBeNull();
    expect(normalizePairOrigin('')).toBeNull();
    expect(normalizePairOrigin('shelf.local')).toBeNull();
    expect(normalizePairOrigin('ftp://shelf.local')).toBeNull();
    expect(normalizePairOrigin('http://shelf.local/api')).toBeNull();
    expect(normalizePairOrigin('http://shelf.local?x=1')).toBeNull();
    expect(normalizePairOrigin('http://user:pass@shelf.local')).toBeNull();
  });
});

describe('isLoopbackHostname', () => {
  it('recognizes loopback and wildcard hosts', () => {
    for (const host of ['localhost', 'LocalHost', 'app.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '::', '0.0.0.0']) {
      expect(isLoopbackHostname(host), host).toBe(true);
    }
  });

  it('treats real addresses as routable', () => {
    for (const host of ['192.168.1.20', '10.0.0.5', 'shelf.local', 'books.example.com', '172.16.0.1']) {
      expect(isLoopbackHostname(host), host).toBe(false);
    }
  });
});

describe('pairOriginsForRequest', () => {
  /** Build a minimal `os.networkInterfaces()` shape for the given addresses. */
  const ifaces = (
    entries: Array<{ address: string; family?: 'IPv4' | 'IPv6'; internal?: boolean }>,
  ): NodeJS.Dict<NetworkInterfaceInfo[]> => ({
    test: entries.map(
      ({ address, family = 'IPv4', internal = false }) =>
        ({ address, family, internal, netmask: '', mac: '', cidr: null }) as unknown as NetworkInterfaceInfo,
    ),
  });

  const LAN = ifaces([
    { address: '127.0.0.1', internal: true },
    { address: '192.168.1.20' },
    { address: 'fe80::1', family: 'IPv6' },
  ]);

  it('surfaces the LAN address when the page is open on localhost', () => {
    // The localhost trap: the admin is on the server box, so the browser origin
    // is useless to a phone. The LAN address must come first, and localhost must
    // still be listed (last) rather than dropped.
    expect(pairOriginsForRequest('localhost:8008', 'http', LAN)).toEqual([
      'http://192.168.1.20:8008',
      'http://localhost:8008',
    ]);
  });

  it('leads with the request origin when it is already routable', () => {
    // Reached over the LAN already — that origin is proven to work, so it wins.
    expect(pairOriginsForRequest('192.168.1.20:4218', 'http', LAN)).toEqual([
      'http://192.168.1.20:4218',
    ]);
  });

  it('keeps the port the request actually arrived on', () => {
    // Docker publishes 4218 -> 8008. The server thinks it lives on 8008, but the
    // only port a phone can reach is the published one from the Host header.
    expect(pairOriginsForRequest('localhost:4218', 'http', LAN)).toEqual([
      'http://192.168.1.20:4218',
      'http://localhost:4218',
    ]);
  });

  it('handles a default port with no explicit port in Host', () => {
    expect(pairOriginsForRequest('books.example.com', 'https', LAN)).toEqual([
      'https://books.example.com',
      'https://192.168.1.20',
    ]);
  });

  it('honours the request scheme', () => {
    expect(pairOriginsForRequest('localhost:8443', 'https', LAN)).toEqual([
      'https://192.168.1.20:8443',
      'https://localhost:8443',
    ]);
  });

  it('lists every non-internal IPv4, skipping internal and IPv6 ones', () => {
    const many = ifaces([
      { address: '127.0.0.1', internal: true },
      { address: '192.168.1.20' },
      { address: '10.8.0.3' },
      { address: 'fe80::abcd', family: 'IPv6' },
      { address: '2001:db8::1', family: 'IPv6' },
    ]);
    expect(pairOriginsForRequest('localhost:8008', 'http', many)).toEqual([
      'http://192.168.1.20:8008',
      'http://10.8.0.3:8008',
      'http://localhost:8008',
    ]);
  });

  it('de-duplicates the request origin against the interface list', () => {
    expect(pairOriginsForRequest('192.168.1.20:8008', 'http', LAN)).toEqual([
      'http://192.168.1.20:8008',
    ]);
  });

  it('handles a bracketed IPv6 Host header without mangling it', () => {
    // `[::1]:8008` split naively on ":" would produce nonsense.
    expect(pairOriginsForRequest('[::1]:8008', 'http', LAN)).toEqual([
      'http://192.168.1.20:8008',
      'http://[::1]:8008',
    ]);
  });

  it('still returns LAN origins when the Host header is missing or unusable', () => {
    expect(pairOriginsForRequest(undefined, 'http', LAN)).toEqual(['http://192.168.1.20']);
    expect(pairOriginsForRequest('', 'http', LAN)).toEqual(['http://192.168.1.20']);
  });

  it('returns an empty list when there is nothing reachable to offer', () => {
    // No Host, no external interfaces — the panel must render "no address" copy
    // rather than a QR of something bogus.
    expect(pairOriginsForRequest(undefined, 'http', ifaces([{ address: '127.0.0.1', internal: true }]))).toEqual([]);
  });

  it('produces origins that buildPairPayload accepts', () => {
    // The two halves are used together; every origin offered must be encodable.
    for (const origin of pairOriginsForRequest('localhost:8008', 'http', LAN)) {
      expect(() => buildPairPayload(origin, 'tok')).not.toThrow();
    }
  });
});
