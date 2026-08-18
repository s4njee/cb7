import { invalidateCacheForComic } from '../../imageResizer';
import { sendJson, sendError } from '../middleware';
import { toWebRecord, overlayUserState } from '../mapping';
import { evictFromCache } from '../archiveCache';
import { requireAdmin, type RouteHandler } from '../context';
import { unlinkIfUploadedFile } from './upload';
import {
  parseComicRouteOptions,
} from './comicRouteHelpers';
import { formatPagedComicResponse } from './routeResponseHelpers';
import { handle as handleMedia } from './comicMediaRoutes';
import { handle as handleMetadata } from './comicMetadataRoutes';
import { readJsonBody, requireNumberArray, requireTrimmedString } from './validation';
import { detectMediaType } from '../../../shared/mediaTypes';
import { sha256File } from '../../fileHasher';
import { enqueueCoverRefresh } from '../../jobs/producer';

/**
 * @module
 * Comics Web API Routes
 * 
 * Architecture overview for Junior Devs:
 * This module implements core routing logic for `/api/comics/*` endpoints:
 * - DELETE /api/comics/:id (Admin delete)
 * - GET /api/comics (List comics with filters and user read status)
 * - GET /api/comics/:id (Get single comic details with user overlay)
 * Media streaming (pages, thumbnails, files) and metadata operations are
 * modularized in `comicMediaRoutes` and `comicMetadataRoutes`.
 */

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, query, currentUser } = ctx;

  // Delegate media requests (thumbnails, pages, book file stream)
  if (
    pathname.match(/^\/api\/comics\/\d+\/thumbnail$/) ||
    pathname.match(/^\/api\/comics\/\d+\/pages\/\d+$/) ||
    pathname.match(/^\/api\/comics\/\d+\/file$/)
  ) {
    return handleMedia(ctx);
  }

  // Delegate metadata requests (search, update, refresh, batch edit)
  if (
    pathname.match(/^\/api\/comics\/\d+\/metadata-search$/) ||
    pathname.match(/^\/api\/comics\/\d+\/metadata$/) ||
    pathname.match(/^\/api\/comics\/\d+\/refresh-metadata$/) ||
    pathname.match(/^\/api\/comics\/\d+\/refresh-embedded-metadata$/) ||
    pathname === '/api/comics/batch-metadata'
  ) {
    return handleMetadata(ctx);
  }

  // Delete comic (admin)
  const deleteMatch = pathname.match(/^\/api\/comics\/(\d+)$/);
  if (method === 'DELETE' && deleteMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(deleteMatch[1], 10);
    if (!(await db.getComicLite(id))) { sendError(res, 404, 'Comic not found'); return true; }
    const [info] = await db.getComicSources([id]);
    await evictFromCache(id);
    await invalidateCacheForComic(id);
    await db.removeComics([id]);
    // Upload-sourced files live only under the server's web-uploads root; the
    // record is their only reference, so removing it removes the file too.
    // Scanned files are never touched.
    if (info?.source === 'upload') {
      await unlinkIfUploadedFile(info.filePath);
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Locate (P1-8, admin): repoint a comic whose file is missing at a new path on
  // disk. Validates the path exists, is the same media type, and isn't claimed by
  // another item, then repoints the row (clearing missing_at) and evicts caches.
  const pathMatch = pathname.match(/^\/api\/comics\/(\d+)\/path$/);
  if (method === 'PUT' && pathMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(pathMatch[1], 10);
    const parsed = await readJsonBody<{ path?: unknown }>(req, res, 64 * 1024);
    if (!parsed.ok) return true;
    const newPath = requireTrimmedString(res, parsed.value.path, 'path');
    if (!newPath) return true;

    const fsp = await import('node:fs/promises');
    try {
      await fsp.access(newPath);
    } catch {
      sendError(res, 400, 'Path does not exist');
      return true;
    }

    const record = await db.getComic(id);
    if (!record) { sendError(res, 404, 'Comic not found'); return true; }
    if (detectMediaType(newPath) !== record.mediaType) {
      sendError(res, 400, `Path is not a ${record.mediaType} file`);
      return true;
    }

    const existing = await db.getComicByPath(newPath);
    if (existing != null && existing.id !== id) {
      sendError(res, 400, 'Path already belongs to another item');
      return true;
    }

    const hash = await sha256File(newPath).catch(() => null);
    await evictFromCache(id);
    await invalidateCacheForComic(id);
    await db.relocateComicPath(id, newPath, hash);
    sendJson(res, 200, { ok: true, filePath: newPath });
    return true;
  }

  // List comics
  if (method === 'GET' && pathname === '/api/comics') {
    const opts = parseComicRouteOptions(query);
    const result = await db.queryComicsForUser(currentUser?.id ?? null, {
      ...opts,
      admin: currentUser?.isAdmin === true,
    });
    sendJson(res, 200, formatPagedComicResponse(result));
    return true;
  }

  // Select-all support: ids of every comic matching the list filters, capped for
  // safety. The batch UI uses this to target "all matching" items at once
  // without paging through full records. Honors per-user library visibility.
  if (method === 'GET' && pathname === '/api/comics/matching-ids') {
    const opts = parseComicRouteOptions(query);
    let libraryId: number | undefined;
    let folderId: number | undefined;
    if (query.libraryId) {
      const parsed = parseInt(query.libraryId, 10);
      if (Number.isFinite(parsed)) libraryId = parsed;
    }
    if (query.folderId) {
      const parsed = parseInt(query.folderId, 10);
      if (Number.isFinite(parsed)) folderId = parsed;
    }
    const result = await db.queryComicIdsForUser(currentUser?.id ?? null, {
      ...opts,
      libraryId,
      folderId,
      admin: currentUser?.isAdmin === true,
    });
    sendJson(res, 200, result);
    return true;
  }

  // Batch cover refresh (admin): enqueue a worker job to re-extract covers for
  // the given ids, or for every comic missing a real cover when allMissing.
  if (method === 'POST' && pathname === '/api/comics/batch-refresh-covers') {
    if (!requireAdmin(ctx)) return true;
    const parsed = await readJsonBody<{ ids?: unknown; allMissing?: boolean }>(req, res);
    if (!parsed.ok) return true;
    let ids: number[] = [];
    if (parsed.value.ids !== undefined) {
      const parsedIds = requireNumberArray(res, parsed.value.ids, 'ids');
      if (!parsedIds) return true;
      ids = parsedIds;
    }
    if (ids.length > 5000) { sendError(res, 400, 'Too many ids (max 5000)'); return true; }
    const jobId = await enqueueCoverRefresh({ ids, allMissing: parsed.value.allMissing === true });
    sendJson(res, 200, { ok: true, jobId });
    return true;
  }

  // Get comic
  const comicMatch = pathname.match(/^\/api\/comics\/(\d+)$/);
  if (method === 'GET' && comicMatch) {
    const id = parseInt(comicMatch[1], 10);
    const record = await db.getComic(id);
    // Per-user library access (P1-1): opening a restricted book is a 404, not a
    // leak — same as if it didn't exist.
    if (!record || (!currentUser?.isAdmin && !(await db.isComicVisible(id, currentUser?.id ?? null)))) {
      sendError(res, 404, 'Comic not found');
      return true;
    }
    sendJson(res, 200, await overlayUserState(toWebRecord(record)!, db, currentUser?.id ?? null));
    return true;
  }

  return false;
};
