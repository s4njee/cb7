import { describe, expect, it } from 'vitest';
import {
  PAIR_TOKEN_REFRESH_MS,
  THEME_LIST,
  autoRescanSavedMessage,
  buildPairPayload,
  clearLibraryRemovedMessage,
  defaultPairOrigin,
  pairOriginCandidates,
  isUnreachableOrigin,
  pairOriginWarning,
  parseAutoRescanMinutes,
  parseWebServerPort,
} from './settingsPanelHelpers';

describe('settingsPanelHelpers', () => {
  it('defines the expected theme swatches', () => {
    expect(THEME_LIST.map((theme) => theme.id)).toEqual(['red', 'blue', 'green', 'purple', 'orange', 'teal']);
  });

  it('parses non-negative auto-rescan intervals', () => {
    expect(parseAutoRescanMinutes('0')).toBe(0);
    expect(parseAutoRescanMinutes('15')).toBe(15);
    expect(parseAutoRescanMinutes('-1')).toBeNull();
    expect(parseAutoRescanMinutes('nope')).toBeNull();
  });

  it('formats auto-rescan saved messages', () => {
    expect(autoRescanSavedMessage(0)).toBe('Auto-rescan disabled.');
    expect(autoRescanSavedMessage(1)).toBe('Folders will rescan every 1 minute.');
    expect(autoRescanSavedMessage(5)).toBe('Folders will rescan every 5 minutes.');
  });

  it('parses valid web server ports only', () => {
    expect(parseWebServerPort('1024')).toBe(1024);
    expect(parseWebServerPort('65535')).toBe(65535);
    expect(parseWebServerPort('1023')).toBeNull();
    expect(parseWebServerPort('65536')).toBeNull();
    expect(parseWebServerPort('nope')).toBeNull();
  });

  it('formats clear-library removal messages', () => {
    expect(clearLibraryRemovedMessage(1)).toBe('Library cleared (1 item removed).');
    expect(clearLibraryRemovedMessage(1200)).toBe('Library cleared (1,200 items removed).');
  });
});

describe('pair panel helpers', () => {
  const LAN = 'http://192.168.1.20:8008';
  const LOCAL = 'http://localhost:8008';

  it('refreshes strictly inside the server TTL', () => {
    // The server mints with a 120 s TTL. If this ever crept up to or past that,
    // the panel would routinely display an already-dead QR.
    expect(PAIR_TOKEN_REFRESH_MS).toBe(90_000);
    expect(PAIR_TOKEN_REFRESH_MS).toBeLessThan(120_000);
  });

  describe('buildPairPayload', () => {
    // These MUST match the vectors in main/webServer/pairPayload.test.ts and in
    // reader/src/lib/pair.test.ts — three implementations of one contract.
    it('matches the server and client vectors', () => {
      expect(buildPairPayload('http://shelf.local')).toBe('cb8pair://v1?url=http%3A%2F%2Fshelf.local');
      expect(buildPairPayload(LAN)).toBe('cb8pair://v1?url=http%3A%2F%2F192.168.1.20%3A8008');
      expect(buildPairPayload('http://192.168.1.20:8008', 'aGVsbG8td29ybGQ')).toBe(
        'cb8pair://v1?url=http%3A%2F%2F192.168.1.20%3A8008&token=aGVsbG8td29ybGQ',
      );
      expect(buildPairPayload('https://books.example.com')).toBe(
        'cb8pair://v1?url=https%3A%2F%2Fbooks.example.com',
      );
    });

    it('omits the token param when there is no token', () => {
      expect(buildPairPayload(LAN)).not.toContain('token');
      expect(buildPairPayload(LAN, '')).not.toContain('token');
    });

    it('leaves base64url token characters intact', () => {
      expect(buildPairPayload(LAN, 'aA0-_zZ9')).toContain('&token=aA0-_zZ9');
    });
  });

  describe('isUnreachableOrigin', () => {
    it('flags loopback and wildcard origins', () => {
      for (const origin of [LOCAL, 'http://127.0.0.1:8008', 'http://127.1.2.3:8008', 'https://localhost', 'http://[::1]:8008', 'http://0.0.0.0:8008']) {
        expect(isUnreachableOrigin(origin), origin).toBe(true);
      }
    });

    it('accepts real addresses', () => {
      for (const origin of [LAN, 'http://10.0.0.5:4218', 'http://shelf.local:8008', 'https://books.example.com']) {
        expect(isUnreachableOrigin(origin), origin).toBe(false);
      }
    });

    it('treats an unparseable origin as unreachable', () => {
      // Fail safe: if we can't tell, warn rather than promise it works.
      expect(isUnreachableOrigin('not a url')).toBe(true);
      expect(isUnreachableOrigin('')).toBe(true);
    });
  });

  describe('pairOriginCandidates', () => {
    it('leads with the page origin — the only address proven to work', () => {
      expect(pairOriginCandidates([LAN], 'http://192.168.50.57:4218')).toEqual([
        'http://192.168.50.57:4218',
        LAN,
      ]);
    });

    it('sinks loopback below the server suggestions', () => {
      expect(pairOriginCandidates([LAN], LOCAL)).toEqual([LAN, LOCAL]);
    });

    it('de-duplicates when the page origin is already offered', () => {
      expect(pairOriginCandidates([LAN, LOCAL], LAN)).toEqual([LAN, LOCAL]);
    });

    it('keeps every candidate when all are loopback', () => {
      expect(pairOriginCandidates([LOCAL], 'http://127.0.0.1:8008')).toEqual([
        'http://127.0.0.1:8008',
        LOCAL,
      ]);
    });
  });

  describe('defaultPairOrigin', () => {
    it('prefers the first reachable origin over localhost', () => {
      expect(defaultPairOrigin([LOCAL, LAN], LOCAL)).toBe(LAN);
    });

    it('keeps the server ordering among reachable origins', () => {
      expect(defaultPairOrigin([LAN, 'http://10.8.0.3:8008'], LOCAL)).toBe(LAN);
    });

    // The Docker default: the server's own interfaces are container IPs, which
    // look routable but are unreachable from a phone. The address the admin is
    // actually browsing on is the one that works.
    it('prefers the page origin over a container IP from the server', () => {
      expect(
        defaultPairOrigin(['http://172.25.0.3:4218', LOCAL], 'http://192.168.50.57:4218'),
      ).toBe('http://192.168.50.57:4218');
    });

    it('falls back to the first offer when every origin is loopback', () => {
      expect(defaultPairOrigin([LOCAL, 'http://127.0.0.1:8008'], LOCAL)).toBe(LOCAL);
    });

    it('falls back to the page origin when the server offered nothing', () => {
      expect(defaultPairOrigin([], LAN)).toBe(LAN);
    });
  });

  describe('pairOriginWarning', () => {
    it('says nothing when the address is routable and the page is too', () => {
      expect(pairOriginWarning(LAN, LAN, 1)).toBeNull();
    });

    it('explains the swap when the page is on localhost but the QR is not', () => {
      const warning = pairOriginWarning(LAN, LOCAL, 2);
      expect(warning).toContain(LOCAL);
      expect(warning).toContain(LAN);
      expect(warning).toContain('same network');
    });

    it('warns hard when the selected address is itself loopback', () => {
      const warning = pairOriginWarning(LOCAL, LOCAL, 2);
      expect(warning).toContain('localhost address');
      expect(warning).toContain('other addresses');
    });

    it('tells the operator what to do when there is no LAN address at all', () => {
      // The dead end: only localhost exists, so "pick another" is useless advice.
      const warning = pairOriginWarning(LOCAL, LOCAL, 1);
      expect(warning).toContain("phone can't reach it");
      expect(warning).toContain('BETTER_AUTH_TRUSTED_ORIGINS');
    });
  });
});
