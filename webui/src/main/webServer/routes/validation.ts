import type * as http from 'node:http';
import { readBody, sendError, type ResolvedUser } from '../middleware';
import type { RequestContext } from '../context';
import type { MediaRecord } from '../../../shared/types';

export type JsonBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false };

export async function readJsonBody<T>(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  maxBytes?: number,
): Promise<JsonBodyResult<T>> {
  const body = await readBody(req, maxBytes);
  try {
    return { ok: true, value: JSON.parse(body) as T };
  } catch {
    sendError(res, 400, 'Invalid JSON');
    return { ok: false };
  }
}

export function requireCurrentUser(ctx: RequestContext): ResolvedUser | null {
  if (ctx.currentUser) return ctx.currentUser;
  sendError(ctx.res, 401, 'Unauthorized');
  return null;
}

export async function requireComic(ctx: RequestContext, comicId: number): Promise<MediaRecord | null> {
  const comic = await ctx.db.getComic(comicId);
  if (comic && (ctx.currentUser?.isAdmin || (await ctx.db.isComicVisible(comicId, ctx.currentUser?.id ?? null)))) {
    return comic;
  }
  sendError(ctx.res, 404, 'Comic not found');
  return null;
}

/**
 * Like `requireComic`, but skips the cover blob and tags queries. Use on hot
 * paths (progress saves, bookmarks, history) that only need existence and
 * basic fields like `pageCount` — the returned record has `tags: []`.
 */
export async function requireComicLite(ctx: RequestContext, comicId: number): Promise<MediaRecord | null> {
  const comic = await ctx.db.getComicLite(comicId);
  if (comic && (ctx.currentUser?.isAdmin || (await ctx.db.isComicVisible(comicId, ctx.currentUser?.id ?? null)))) {
    return comic;
  }
  sendError(ctx.res, 404, 'Comic not found');
  return null;
}

export function parseBoundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function requireTrimmedString(
  res: http.ServerResponse,
  value: unknown,
  fieldName: string,
): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    sendError(res, 400, `Provide "${fieldName}" (string)`);
    return null;
  }
  return value.trim();
}

export function requireString(
  res: http.ServerResponse,
  value: unknown,
  fieldName: string,
): string | null {
  if (typeof value !== 'string' || value.length < 1) {
    sendError(res, 400, `Provide "${fieldName}" (string)`);
    return null;
  }
  return value;
}

export function requireNumberArray(
  res: http.ServerResponse,
  value: unknown,
  fieldName: string,
): number[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    sendError(res, 400, `Provide "${fieldName}" (non-empty array)`);
    return null;
  }
  return value.map(Number);
}

export function readPageIndex(
  res: http.ServerResponse,
  value: unknown,
  comic: MediaRecord,
  fieldName = 'page',
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    sendError(res, 400, `"${fieldName}" must be a finite integer`);
    return null;
  }
  if (value < 0) {
    sendError(res, 400, `"${fieldName}" must be 0 or greater`);
    return null;
  }
  if (comic.pageCount > 0 && value >= comic.pageCount) {
    sendError(res, 400, `"${fieldName}" must be less than pageCount (${comic.pageCount})`);
    return null;
  }
  return value;
}

/** Longest accepted locator. Real EPUB CFIs are far shorter; this is a sanity
 *  bound so a client can't push arbitrary blobs into a TEXT column. */
export const MAX_LOCATION_LENGTH = 512;

/**
 * Validates an opaque reading locator (an EPUB CFI). Unlike `readPageIndex`
 * there is nothing to bound it against — the server does not parse CFIs — so we
 * only require a non-empty string of sane length. Sends 400 and returns null on
 * anything else.
 */
export function readLocation(
  res: http.ServerResponse,
  value: unknown,
  fieldName = 'location',
): string | null {
  if (typeof value !== 'string') {
    sendError(res, 400, `"${fieldName}" must be a string`);
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    sendError(res, 400, `"${fieldName}" must be a non-empty string`);
    return null;
  }
  if (trimmed.length > MAX_LOCATION_LENGTH) {
    sendError(res, 400, `"${fieldName}" must be at most ${MAX_LOCATION_LENGTH} characters`);
    return null;
  }
  return trimmed;
}

export async function requireBookmarkInComic(
  ctx: RequestContext,
  userId: number,
  comicId: number,
  bookmarkId: number,
): Promise<boolean> {
  const bookmarks = await ctx.db.listBookmarks(userId, comicId);
  const found = bookmarks.some((bookmark) => bookmark.id === bookmarkId);
  if (found) return true;
  sendError(ctx.res, 404, 'Bookmark not found');
  return false;
}
