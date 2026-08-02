import type { QueryParams } from './types';

export const API = '';

export class ApiError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, { status, code }: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'ApiError';
    if (status != null) this.status = status;
    if (code != null) this.code = code;
  }
}

function buildQuery(params?: QueryParams): string {
  if (!params) return '';
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === null) continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export async function parseErrorBody(res: Response, fallback: string): Promise<{ message: string; code?: string }> {
  const body = await res.json().catch(() => undefined);
  if (!body || typeof body !== 'object') {
    return { message: fallback };
  }
  const fields = body as Record<string, unknown>;
  const message =
    (typeof fields.message === 'string' && fields.message) ||
    (typeof fields.error === 'string' && fields.error) ||
    fallback;
  const code = typeof fields.code === 'string' ? fields.code : undefined;
  return { message, code };
}

export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  return (await parseErrorBody(res, fallback)).message;
}

export interface RequestOptions<Body = unknown> {
  query?: QueryParams;
  body?: Body;
  credentials?: RequestCredentials;
  parse?: 'json' | 'none';
  parseError?: 'soft' | 'strict';
  headers?: Record<string, string>;
}

export async function request<T = unknown, Body = unknown>(
  method: string,
  path: string,
  opts: RequestOptions<Body> = {},
): Promise<T> {
  const { query, body, credentials, parse = 'json', parseError, headers } = opts;
  const init: RequestInit = {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    credentials,
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(`${API}${path}${buildQuery(query)}`, init);
  if (!res.ok) {
    const { message, code } = await parseErrorBody(res, `API error ${res.status}`);
    throw new ApiError(message, { status: res.status, code });
  }
  if (parse === 'none') return undefined as T;
  if (parseError === 'soft') {
    return res.json().catch(() => ({ ok: true })) as Promise<T>;
  }
  return res.json() as Promise<T>;
}

export const get = <T = unknown>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts);
export const post = <T = unknown, Body = unknown>(path: string, opts?: RequestOptions<Body>) =>
  request<T, Body>('POST', path, opts);
export const put = <T = unknown, Body = unknown>(path: string, opts?: RequestOptions<Body>) =>
  request<T, Body>('PUT', path, opts);
export const del = <T = unknown, Body = unknown>(path: string, opts?: RequestOptions<Body>) =>
  request<T, Body>('DELETE', path, opts);
