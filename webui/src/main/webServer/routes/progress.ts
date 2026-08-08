import { sendJson, sendError } from '../middleware';
import { toWebRecord, overlayUserStateMany } from '../mapping';
import type { RouteHandler } from '../context';
import {
  parseBoundedInteger,
  readJsonBody,
  readLocation,
  readPageIndex,
  requireBookmarkInComic,
  requireComicLite,
  requireCurrentUser,
} from './validation';
import type { BookmarkAnchor } from '../../db/bookmarks';
import {
  buildProgressUpdate,
  hasProgressUpdate,
  type ProgressUpdateBody,
} from './progressRouteHelpers';

/**
 * @module
 * HTTP Route Handlers for Per-User Reading Progress
 *
 * Architecture overview for Junior Devs:
 * Serves the `/api/*` endpoints that track where each user is in each book:
 * saving the current page/location, marking things read/unread, and the
 * bookmarks that power the "continue reading" and "recently read" shelves.
 * Bookmarks, like progress, anchor by page (comics/PDFs) or by EPUB CFI
 * (reflowable books) — POST accepts exactly one of the two.
 * Progress is always scoped to the logged-in user (via `requireCurrentUser`), so
 * one person's position never affects another's. SQL lives in `db/progress.ts`.
 * Returns `true` once it owns the request.
 */

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, query, currentUser, guestEnabled } = ctx;

  // Update progress
  const progressMatch = pathname.match(/^\/api\/comics\/(\d+)\/progress$/);
  if (method === 'PUT' && progressMatch) {
    // Logged-in users save to their own per-user row. Guests (when guest access
    // is enabled) save to the comic's shared columns instead, so a deployment
    // with no user management still resumes. Block writes only when there is no
    // user AND guest access is off.
    if (!currentUser && !guestEnabled) {
      requireCurrentUser(ctx); // sends 401
      return true;
    }
    const id = parseInt(progressMatch[1], 10);
    const comic = await requireComicLite(ctx, id);
    if (!comic) return true;
    const parsedBody = await readJsonBody<ProgressUpdateBody>(req, res);
    if (!parsedBody.ok) return true;
    const parsed = parsedBody.value;
    let page: number | undefined;
    if (parsed.page !== undefined) {
      const validatedPage = readPageIndex(res, parsed.page, comic);
      if (validatedPage === null) return true;
      page = validatedPage;
    }
    const opts = buildProgressUpdate(parsed, page, comic.pageCount);
    if (!hasProgressUpdate(opts)) {
      sendError(res, 400, 'Provide "page", "location", or "completed"');
      return true;
    }
    // Per-user store — authoritative, and takes priority on read.
    if (currentUser) await db.upsertUserProgress(currentUser.id, id, opts);
    // Shared store on the comic itself — the only store for guests, and the
    // fallback a logged-in user inherits until they open the book themselves. A
    // record only ever carries page (comic/PDF) or location (EPUB), so writing
    // each present field is safe.
    if (opts.page !== undefined && opts.page !== null) await db.updateReadingProgress(id, opts.page);
    if (typeof opts.location === 'string') await db.updateReadingLocation(id, opts.location);
    if (typeof opts.percent === 'number') await db.updateReadingPercent(id, opts.percent);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Clear progress
  if (method === 'DELETE' && progressMatch) {
    const user = requireCurrentUser(ctx);
    if (!user) return true;
    const id = parseInt(progressMatch[1], 10);
    if (!(await requireComicLite(ctx, id))) return true;
    await db.clearUserProgress(user.id, id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Favorite toggle
  const favMatch = pathname.match(/^\/api\/comics\/(\d+)\/favorite$/);
  if (favMatch && (method === 'POST' || method === 'DELETE')) {
    const user = requireCurrentUser(ctx);
    if (!user) return true;
    const id = parseInt(favMatch[1], 10);
    if (!(await requireComicLite(ctx, id))) return true;
    if (method === 'POST') await db.addFavorite(user.id, id);
    else await db.removeFavorite(user.id, id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Bookmarks
  const bookmarksMatch = pathname.match(/^\/api\/comics\/(\d+)\/bookmarks$/);
  if (method === 'GET' && bookmarksMatch) {
    const user = requireCurrentUser(ctx);
    if (!user) return true;
    const id = parseInt(bookmarksMatch[1], 10);
    if (!(await requireComicLite(ctx, id))) return true;
    sendJson(res, 200, await db.listBookmarks(user.id, id));
    return true;
  }
  if (method === 'POST' && bookmarksMatch) {
    const user = requireCurrentUser(ctx);
    if (!user) return true;
    const id = parseInt(bookmarksMatch[1], 10);
    const comic = await requireComicLite(ctx, id);
    if (!comic) return true;
    const parsedBody = await readJsonBody<{ page?: number; location?: string; note?: string | null }>(req, res);
    if (!parsedBody.ok) return true;
    const parsed = parsedBody.value;
    // A bookmark anchors to exactly one spot. Comics/PDFs send a page index;
    // reflowable EPUBs have no page index and send a CFI in "location". Both at
    // once would be an ambiguous anchor, neither is nothing to bookmark.
    const hasPage = parsed.page !== undefined && parsed.page !== null;
    const hasLocation = parsed.location !== undefined && parsed.location !== null;
    if (hasPage && hasLocation) {
      sendError(res, 400, 'Provide either "page" or "location", not both');
      return true;
    }
    if (!hasPage && !hasLocation) {
      sendError(res, 400, 'Provide "page" or "location"');
      return true;
    }
    let anchor: BookmarkAnchor;
    if (hasPage) {
      const page = readPageIndex(res, parsed.page, comic);
      if (page === null) return true;
      anchor = { page };
    } else {
      const location = readLocation(res, parsed.location);
      if (location === null) return true;
      anchor = { location };
    }
    sendJson(res, 201, await db.createBookmark(user.id, id, anchor, parsed.note ?? null));
    return true;
  }
  const bookmarkItemMatch = pathname.match(/^\/api\/comics\/(\d+)\/bookmarks\/(\d+)$/);
  if (method === 'PUT' && bookmarkItemMatch) {
    const user = requireCurrentUser(ctx);
    if (!user) return true;
    const comicId = parseInt(bookmarkItemMatch[1], 10);
    const bookmarkId = parseInt(bookmarkItemMatch[2], 10);
    if (!(await requireComicLite(ctx, comicId))) return true;
    if (!(await requireBookmarkInComic(ctx, user.id, comicId, bookmarkId))) return true;
    const parsedBody = await readJsonBody<{ note?: string | null }>(req, res);
    if (!parsedBody.ok) return true;
    await db.updateBookmark(user.id, bookmarkId, parsedBody.value.note ?? null);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (method === 'DELETE' && bookmarkItemMatch) {
    const user = requireCurrentUser(ctx);
    if (!user) return true;
    const comicId = parseInt(bookmarkItemMatch[1], 10);
    const bookmarkId = parseInt(bookmarkItemMatch[2], 10);
    if (!(await requireComicLite(ctx, comicId))) return true;
    if (!(await requireBookmarkInComic(ctx, user.id, comicId, bookmarkId))) return true;
    await db.deleteBookmark(user.id, bookmarkId);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // History
  if (method === 'POST' && pathname === '/api/history') {
    const user = requireCurrentUser(ctx);
    if (!user) return true;
    const parsedBody = await readJsonBody<{ comicId?: number; action?: string; page?: number | null }>(req, res);
    if (!parsedBody.ok) return true;
    const parsed = parsedBody.value;
    if (typeof parsed.comicId !== 'number' || typeof parsed.action !== 'string') {
      sendError(res, 400, 'Provide "comicId" and "action"'); return true;
    }
    const comic = await requireComicLite(ctx, parsed.comicId);
    if (!comic) return true;
    const action = parsed.action.trim();
    if (!action) { sendError(res, 400, 'Provide non-empty "action"'); return true; }
    if (parsed.page !== undefined && parsed.page !== null) {
      const page = readPageIndex(res, parsed.page, comic);
      if (page === null) return true;
    }
    await db.logHistory(user.id, parsed.comicId, action, parsed.page ?? null);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (method === 'GET' && pathname === '/api/history') {
    const user = requireCurrentUser(ctx);
    if (!user) return true;
    const offset = parseBoundedInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = parseBoundedInteger(query.limit, 50, 1, 200);
    sendJson(res, 200, await db.getHistory(user.id, offset, limit));
    return true;
  }

  // Series
  if (method === 'GET' && pathname === '/api/series') {
    const series = (await db.getAllSeries()).map((s) => ({
      name: s.name,
      count: s.count,
      thumbnailUrl: s.coverComicId ? `/api/comics/${s.coverComicId}/thumbnail` : null,
    }));
    sendJson(res, 200, series);
    return true;
  }
  const seriesComicsMatch = pathname.match(/^\/api\/series\/([^/]+)\/comics$/);
  if (method === 'GET' && seriesComicsMatch) {
    const name = seriesComicsMatch[1];
    const records = await db.getSeriesComics(name);
    const uid = currentUser?.id ?? null;
    sendJson(res, 200, await overlayUserStateMany(records.map((r) => toWebRecord(r)!), db, uid));
    return true;
  }

  // Recently read
  if (method === 'GET' && pathname === '/api/recently-read') {
    const limit = parseBoundedInteger(query.limit, 20, 1, 200);
    const mediaType = query.mediaType as 'comic' | 'book' | undefined;
    const records = currentUser
      ? await db.getRecentlyReadByUser(currentUser.id, limit, mediaType)
      : await db.getRecentlyRead(limit, mediaType);
    sendJson(res, 200, records.map(toWebRecord));
    return true;
  }

  // Continue reading — recently read, filtered to in-progress only.
  if (method === 'GET' && pathname === '/api/continue-reading') {
    const limit = parseBoundedInteger(query.limit, 20, 1, 200);
    const mediaType = query.mediaType as 'comic' | 'book' | undefined;
    const records = currentUser
      ? await db.getContinueReadingByUser(currentUser.id, limit, mediaType)
      : await db.getContinueReading(limit, mediaType);
    sendJson(res, 200, records.map(toWebRecord));
    return true;
  }

  return false;
};
