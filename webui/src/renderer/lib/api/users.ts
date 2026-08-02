import { del, get, post, put } from './client';
import type { UserRecord } from './types';

export const getUsers = (): Promise<UserRecord[]> =>
  get<UserRecord[]>('/api/users');

export const createUser = (
  username: string,
  password: string,
  isAdmin = false,
): Promise<{ id: number; username: string; isAdmin: boolean }> =>
  post<UserRecord>('/api/users', { body: { username, password, isAdmin } });

export const deleteUser = (id: number): Promise<void> =>
  del<void>(`/api/users/${id}`, { parse: 'none' });

export const setUserRole = (id: number, isAdmin: boolean): Promise<void> =>
  put<void>(`/api/users/${id}/role`, { body: { isAdmin }, parse: 'none' });
