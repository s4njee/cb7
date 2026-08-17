import { describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcryptjs';
import { parseBasicAuthHeader, resolveBasicAuthUser } from './basicAuth';
import type { LibraryDatabase } from '../libraryDatabase';

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('parseBasicAuthHeader', () => {
  it('decodes a valid Basic header', () => {
    expect(parseBasicAuthHeader(basic('alice', 'secret'))).toEqual({ username: 'alice', password: 'secret' });
  });

  it('keeps colons inside the password (splits on the first colon)', () => {
    expect(parseBasicAuthHeader(basic('alice', 'pa:ss:word'))).toEqual({ username: 'alice', password: 'pa:ss:word' });
  });

  it('returns null when the header is absent or not Basic', () => {
    expect(parseBasicAuthHeader(undefined)).toBeNull();
    expect(parseBasicAuthHeader('Bearer abc')).toBeNull();
    expect(parseBasicAuthHeader('Basic')).toBeNull();
  });

  it('returns null for malformed base64 or an empty username', () => {
    expect(parseBasicAuthHeader('Basic !!!not-base64!!!')).toBeNull();
    expect(parseBasicAuthHeader('Basic ' + Buffer.from(':pw').toString('base64'))).toBeNull();
  });
});

describe('resolveBasicAuthUser', () => {
  const hash = bcrypt.hashSync('secret', 4);
  const db = {
    getUserByUsername: vi.fn(async (username: string) =>
      username === 'alice'
        ? { id: 1, username: 'alice', passwordHash: hash, isAdmin: true, createdAt: '2026-01-01' }
        : null,
    ),
  } as unknown as LibraryDatabase;

  it('resolves a valid username/password to the user', async () => {
    const user = await resolveBasicAuthUser(db, basic('alice', 'secret'));
    expect(user).toEqual({ id: 1, username: 'alice', isAdmin: true });
  });

  it('returns null on a wrong password', async () => {
    expect(await resolveBasicAuthUser(db, basic('alice', 'nope'))).toBeNull();
  });

  it('returns null for an unknown user', async () => {
    expect(await resolveBasicAuthUser(db, basic('bob', 'secret'))).toBeNull();
  });

  it('returns null for a malformed or missing header', async () => {
    expect(await resolveBasicAuthUser(db, undefined)).toBeNull();
    expect(await resolveBasicAuthUser(db, 'Bearer x')).toBeNull();
  });
});
