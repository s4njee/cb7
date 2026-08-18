import { describe, expect, it } from 'vitest';
import {
  MDNS_SERVICE_FQDN,
  MDNS_SERVICE_PROTOCOL,
  MDNS_SERVICE_TYPE,
  buildTxt,
  mdnsEnabled,
} from './mdns';

describe('mdnsEnabled', () => {
  it('advertises by default when CB8_MDNS is unset or empty', () => {
    expect(mdnsEnabled({})).toBe(true);
    expect(mdnsEnabled({ CB8_MDNS: '' })).toBe(true);
    expect(mdnsEnabled({ CB8_MDNS: '   ' })).toBe(true);
  });

  it('opts out on 0 and false', () => {
    expect(mdnsEnabled({ CB8_MDNS: '0' })).toBe(false);
    expect(mdnsEnabled({ CB8_MDNS: 'false' })).toBe(false);
    expect(mdnsEnabled({ CB8_MDNS: 'FALSE' })).toBe(false);
    expect(mdnsEnabled({ CB8_MDNS: ' 0 ' })).toBe(false);
  });

  it('treats every other value as opted in', () => {
    expect(mdnsEnabled({ CB8_MDNS: '1' })).toBe(true);
    expect(mdnsEnabled({ CB8_MDNS: 'true' })).toBe(true);
    expect(mdnsEnabled({ CB8_MDNS: 'yes' })).toBe(true);
    expect(mdnsEnabled({ CB8_MDNS: 'off' })).toBe(true);
  });
});

describe('buildTxt', () => {
  it('builds the TXT record the client contract specifies', () => {
    expect(buildTxt({ version: '1.0.5', name: 'freya' })).toEqual({
      ver: '1.0.5',
      name: 'freya',
      path: '/api',
    });
  });

  it('pins path to /api regardless of the instance', () => {
    expect(buildTxt({ version: '2.0.0-beta.1', name: "Sanjee's Shelf" }).path).toBe('/api');
  });

  it('passes the name through verbatim so two servers on one LAN are tellable apart', () => {
    expect(buildTxt({ version: '1.0.5', name: 'basement-nas.local' }).name).toBe(
      'basement-nas.local',
    );
  });

  it('emits exactly the three contract keys and nothing else', () => {
    expect(Object.keys(buildTxt({ version: '1.0.5', name: 'freya' })).sort()).toEqual([
      'name',
      'path',
      'ver',
    ]);
  });
});

describe('service type', () => {
  it('resolves to _cb8._tcp.local. the way bonjour-service composes it', () => {
    // bonjour-service builds `_<type>._<protocol>` + `.local`; keep the
    // spelled-out constant honest against the parts we actually publish.
    expect(`_${MDNS_SERVICE_TYPE}._${MDNS_SERVICE_PROTOCOL}.local.`).toBe(MDNS_SERVICE_FQDN);
  });
});
