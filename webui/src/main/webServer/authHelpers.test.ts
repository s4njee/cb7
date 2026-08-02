import { describe, expect, it } from 'vitest';
import {
  authResetPasswordLink,
  diagnoseUntrustedOrigin,
  isUsableSecret,
  parseTrustedOriginExtras,
  resolveAuthBaseURL,
  trustedOriginsForBaseURL,
  withSameHostOrigin,
} from './authHelpers';

describe('authHelpers', () => {
  it('resolves the configured auth base URL with a localhost default', () => {
    expect(resolveAuthBaseURL(undefined)).toBe('http://localhost:8008');
    expect(resolveAuthBaseURL('https://cb8.example')).toBe('https://cb8.example');
  });

  it('builds SPA reset-password links with an encoded token', () => {
    expect(authResetPasswordLink('http://localhost:8008', 'a b/c?')).toBe(
      'http://localhost:8008/#/reset-password?token=a%20b%2Fc%3F',
    );
  });

  it('parses comma-separated trusted-origin extras', () => {
    expect(parseTrustedOriginExtras(' https://one.example, ,https://two.example ')).toEqual([
      'https://one.example',
      'https://two.example',
    ]);
    expect(parseTrustedOriginExtras(undefined)).toEqual([]);
  });

  it('expands trusted origins for loopback aliases, LAN IPs, and extras', () => {
    const origins = trustedOriginsForBaseURL(
      'http://localhost:8008',
      {
        en0: [
          { address: '192.168.1.50', family: 'IPv4', internal: false } as never,
          { address: '127.0.0.1', family: 'IPv4', internal: true } as never,
        ],
      },
      'https://cb8.example',
    );

    expect(origins).toEqual([
      'http://localhost:8008',
      'http://127.0.0.1:8008',
      'http://0.0.0.0:8008',
      'http://[::1]:8008',
      'http://192.168.1.50:8008',
      'https://cb8.example',
    ]);
  });

  it('keeps invalid base URLs without crashing', () => {
    expect(trustedOriginsForBaseURL('not a url', {}, undefined)).toEqual(['not a url']);
  });

  it('adds an origin only when it matches the request host', () => {
    expect(withSameHostOrigin(['http://localhost:8008'], 'http://cb8.local:8008', 'cb8.local:8008')).toEqual([
      'http://localhost:8008',
      'http://cb8.local:8008',
    ]);
    expect(withSameHostOrigin(['http://localhost:8008'], 'http://other.local:8008', 'cb8.local:8008')).toEqual([
      'http://localhost:8008',
    ]);
    expect(withSameHostOrigin(['http://localhost:8008'], 'bad url', 'cb8.local:8008')).toEqual([
      'http://localhost:8008',
    ]);
  });

  // Epic A — auth origins: private LAN access by IP is same-origin (Origin
  // matches Host) and is trusted without enumerating it in config.
  it('trusts a private LAN origin that matches the request host', () => {
    expect(
      withSameHostOrigin(['http://localhost:8008'], 'http://192.168.1.50:4218', '192.168.1.50:4218'),
    ).toEqual(['http://localhost:8008', 'http://192.168.1.50:4218']);
  });

  // A true cross-site origin (Origin host != Host) stays rejected even when
  // proxy headers are absent — preserves public strictness.
  it('does not trust an origin whose host differs from Host or forwarded host', () => {
    expect(
      withSameHostOrigin(['http://localhost:8008'], 'https://evil.example', 'cb8.local:4218', 'cb8.local:4218', 'http'),
    ).toEqual(['http://localhost:8008', 'http://cb8.local:4218']);
  });

  // Behind a proxy: Origin is the public URL, Host is the internal upstream.
  // When proxy headers are supplied, the public origin is trusted via the
  // forwarded host, and the reconstructed scheme://host is added too.
  it('trusts the public origin behind a reverse proxy via forwarded headers', () => {
    expect(
      withSameHostOrigin(
        ['http://localhost:8008'],
        'https://reader.example.com',
        'cb8:8008',
        'reader.example.com',
        'https',
      ),
    ).toEqual(['http://localhost:8008', 'https://reader.example.com']);
  });

  it('reconstructs the forwarded origin even when the Origin header is absent', () => {
    expect(
      withSameHostOrigin(['http://localhost:8008'], null, 'cb8:8008', 'reader.example.com', 'https'),
    ).toEqual(['http://localhost:8008', 'https://reader.example.com']);
  });

  it('takes the first value of a comma-separated forwarded host chain', () => {
    expect(
      withSameHostOrigin(['http://localhost:8008'], null, 'cb8:8008', 'reader.example.com, internal-lb', 'https'),
    ).toEqual(['http://localhost:8008', 'https://reader.example.com']);
  });

  it('diagnoses an untrusted login origin and stays quiet for trusted ones', () => {
    const trusted = ['http://localhost:8008', 'http://cb8.local:4218'];
    expect(diagnoseUntrustedOrigin(trusted, 'http://cb8.local:4218')).toBeNull();
    expect(diagnoseUntrustedOrigin(trusted, null)).toBeNull();
    const msg = diagnoseUntrustedOrigin(trusted, 'https://reader.example.com');
    expect(msg).toContain('https://reader.example.com');
    expect(msg).toContain('BETTER_AUTH_TRUSTED_ORIGINS');
  });

  // Epic B — secret precedence: an explicit env secret wins when usable, a
  // too-short value is ignored (falls back to stored/generated), matching the
  // pre-existing resolveSecret behavior.
  it('treats a secret as usable only when it is at least 32 characters', () => {
    expect(isUsableSecret('a'.repeat(32))).toBe(true);
    expect(isUsableSecret('a'.repeat(64))).toBe(true);
    expect(isUsableSecret('too-short')).toBe(false);
    expect(isUsableSecret('')).toBe(false);
    expect(isUsableSecret(undefined)).toBe(false);
    expect(isUsableSecret(null)).toBe(false);
  });
});
