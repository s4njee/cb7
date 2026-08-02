import { get, post, request } from './client';
import type { AuthMutationResponse, SessionResponse } from './types';

export async function getSession(): Promise<SessionResponse> {
  try {
    return await get<SessionResponse>('/api/auth/session');
  } catch {
    return { authenticated: false, user: null, host: false, guestAccess: false };
  }
}

export async function login(identifier: string, password: string): Promise<AuthMutationResponse> {
  const isEmail = identifier.includes('@');
  const path = isEmail ? '/api/auth/sign-in/email' : '/api/auth/sign-in/username';
  const body = isEmail ? { email: identifier, password } : { username: identifier, password };
  return request<AuthMutationResponse>('POST', path, { body, credentials: 'same-origin' });
}

export const logout = (): Promise<void> =>
  post<void>('/api/auth/sign-out', { credentials: 'same-origin', parse: 'none' });

export const requestPasswordReset = (email: string): Promise<AuthMutationResponse> =>
  post<AuthMutationResponse>('/api/auth/forget-password', {
    body: { email },
    credentials: 'same-origin',
    parseError: 'soft',
  });

export const resetPassword = (newPassword: string, token: string): Promise<AuthMutationResponse> =>
  post<AuthMutationResponse>('/api/auth/reset-password', {
    body: { newPassword, token },
    credentials: 'same-origin',
  });

export const sendVerificationEmail = (email: string): Promise<AuthMutationResponse> =>
  post<AuthMutationResponse>('/api/auth/send-verification-email', {
    body: { email },
    credentials: 'same-origin',
    parseError: 'soft',
  });
