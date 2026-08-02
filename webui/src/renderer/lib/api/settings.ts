import { del, get, post, put } from './client';
import type { InitialCredentials } from './types';
import type { PairInfoResponse, PairTokenResponse } from '../../../shared/apiTypes';

export const setGuestAccess = (enabled: boolean): Promise<void> =>
  put<void>('/api/settings/guest-access', { body: { enabled }, parse: 'none' });

export const fetchAutoRescanInterval = (): Promise<{ minutes: number }> =>
  get<{ minutes: number }>('/api/settings/auto-rescan-interval');

export const setAutoRescanInterval = (minutes: number): Promise<void> =>
  put<void>('/api/settings/auto-rescan-interval', { body: { minutes }, parse: 'none' });

export async function fetchInitialCredentials(): Promise<InitialCredentials | null> {
  const creds = await get<InitialCredentials | null>('/api/settings/initial-credentials');
  if (!creds) return null;
  return {
    ...creds,
    initial_password: creds.initial_password ?? creds.password ?? null,
  };
}

export const clearInitialCredentials = (): Promise<void> =>
  del<void>('/api/settings/initial-credentials', { parse: 'none' });

/**
 * Addresses this server thinks a phone could reach it on, best candidate first.
 * The pair panel needs this because `window.location.origin` is usually
 * `localhost` (the admin is sitting at the server), which no phone can reach.
 */
export const fetchPairInfo = (): Promise<PairInfoResponse> =>
  get<PairInfoResponse>('/api/settings/pair-info');

/**
 * Mint a single-use, ~2-minute pairing token bound to the current user.
 *
 * The returned token is a **live credential**: whoever holds it can sign in as
 * you until it expires or is redeemed once. Keep it in component state only —
 * never localStorage, never a URL, never `console.log`.
 */
export const createPairToken = (): Promise<PairTokenResponse> =>
  post<PairTokenResponse>('/api/auth/pair-token');
