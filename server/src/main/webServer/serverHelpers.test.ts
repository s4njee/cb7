import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canAccessApiRequest,
  resolveStaticRoot,
  shouldDelegateToBetterAuth,
} from './serverHelpers';

describe('serverHelpers', () => {
  it('uses an explicit static root override and warns when it is missing', () => {
    expect(resolveStaticRoot('/runtime', {
      override: '/missing/web',
      resourcesPath: '/resources',
      exists: () => false,
    })).toEqual({
      root: '/missing/web',
      candidates: ['/missing/web'],
      warnings: ['CB8_WEB_ROOT is set to "/missing/web" but that path does not exist; SPA assets will 404.'],
    });
  });

  it('selects the first existing static root candidate', () => {
    const runtimeDir = path.join(path.sep, 'app', 'main');
    const existing = path.join(runtimeDir, '../dist/web');
    const resolution = resolveStaticRoot(runtimeDir, {
      resourcesPath: '/resources',
      exists: (candidate) => candidate === existing,
    });

    expect(resolution.root).toBe(existing);
    expect(resolution.warnings).toEqual([]);
  });

  it('falls back to the first static root candidate with a useful warning', () => {
    const runtimeDir = path.join(path.sep, 'app', 'main');
    const resolution = resolveStaticRoot(runtimeDir, {
      resourcesPath: '/resources',
      exists: () => false,
    });

    expect(resolution.root).toBe(path.join(runtimeDir, '../../dist/web'));
    expect(resolution.warnings[0]).toContain('Renderer assets not found');
    expect(resolution.warnings[0]).toContain('pnpm build:renderer');
  });

  it('delegates only non-owned auth endpoints to Better Auth', () => {
    expect(shouldDelegateToBetterAuth('/api/auth/sign-in/username')).toBe(true);
    expect(shouldDelegateToBetterAuth('/api/auth/sign-up/email')).toBe(false);
    expect(shouldDelegateToBetterAuth('/api/auth/session')).toBe(false);
    expect(shouldDelegateToBetterAuth('/api/comics')).toBe(false);
  });

  // Better Auth knows nothing about QR pairing: if these were delegated the
  // routes would 404 and the whole feature would be dead on arrival.
  it('keeps the pairing endpoints in-house', () => {
    expect(shouldDelegateToBetterAuth('/api/auth/pair')).toBe(false);
    expect(shouldDelegateToBetterAuth('/api/auth/pair-token')).toBe(false);
  });

  it('decides unauthenticated API access from public endpoints and guest GET access', () => {
    expect(canAccessApiRequest('/api/auth/login', 'POST', null, false)).toBe(true);
    expect(canAccessApiRequest('/api/settings/initial-credentials', 'GET', null, false)).toBe(false);
    expect(canAccessApiRequest('/api/comics', 'GET', null, true)).toBe(true);
    expect(canAccessApiRequest('/api/comics', 'POST', null, true)).toBe(false);
    expect(canAccessApiRequest('/api/comics', 'GET', null, false)).toBe(false);
    expect(canAccessApiRequest('/api/comics', 'POST', { id: 1 }, false)).toBe(true);
  });

  // Redeeming a code is how a device gets its session — requiring one would be
  // circular. Minting still requires a real user.
  it('lets an anonymous device redeem a pairing code but not mint one', () => {
    expect(canAccessApiRequest('/api/auth/pair', 'POST', null, false)).toBe(true);
    expect(canAccessApiRequest('/api/auth/pair-token', 'POST', null, false)).toBe(false);
    expect(canAccessApiRequest('/api/auth/pair-token', 'POST', null, true)).toBe(false);
    expect(canAccessApiRequest('/api/auth/pair-token', 'POST', { id: 1 }, false)).toBe(true);
  });
});
