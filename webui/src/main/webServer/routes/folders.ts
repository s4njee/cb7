import * as path from 'node:path';
import { sendJson, sendError } from '../middleware';
import { requireAdmin, type RouteHandler, type RequestContext } from '../context';
import { enqueueScan } from '../../jobs/producer';
import { QUEUE } from '../../jobs/queues';
import { readJsonBody, requireNumberArray, requireTrimmedString } from './validation';
import {
  findCommonDir,
  folderScanMetaKey,
  folderThumbnailUrl,
  parseFolderRouteOptions,
  withGroupThumbnail,
} from './folderRouteHelpers';
import { formatPagedComicResponse, type PagedComicResult } from './routeResponseHelpers';

/**
 * @module
 * HTTP Route Handlers for Folders
 *
 * Architecture overview for Junior Devs:
 * Serves the `/api/folders/*` endpoints: listing folders, the comics inside a
 * folder, the series/volume/chapter rollups, and admin actions like scanning a
 * path into a folder (with streaming progress). Each exported `handle` is a
 * `RouteHandler` that returns `true` when it owns the request. Parsing/validation
 * comes from `./validation`; SQL lives in the DB layer — keep this file about
 * request shape and responses.
 */

/** Shape a list of hierarchy groups (series/volume/chapter) into the API response. */
function sendGroups<T extends { coverComicId: number | null }>(
  res: Parameters<typeof sendJson>[0],
  groups: T[],
): void {
  const withThumbs = groups.map(withGroupThumbnail);
  sendJson(res, 200, { groups: withThumbs, totalCount: withThumbs.length });
}

/** Shape a paged comic result (with per-user favorite overlay) into the API response. */
function sendComics(
  res: Parameters<typeof sendJson>[0],
  result: PagedComicResult,
): void {
  sendJson(res, 200, formatPagedComicResponse(result));
}

/**
 * Shared series → volume → chapter hierarchy dispatch for both the folder-scoped
 * (`/api/folders/:id/...`) and global browse (`/api/browse/...`) trees. The two
 * differ only in scope, so they route through here parameterized by `folderId`
 * (`null` means library-wide). `sub` is the path *after* the scope prefix, e.g.
 * `/series`, `/series/:key/volumes`, `.../comics`. Returns false when `sub` is
 * not a hierarchy path so the caller can fall through to other routes.
 */
async function handleHierarchy(ctx: RequestContext, folderId: number | null, sub: string): Promise<boolean> {
  const { res, db, method, query, currentUser } = ctx;
  if (method !== 'GET') return false;
  const userId = currentUser?.id ?? null;
  const opts = parseFolderRouteOptions(query);

  // Scope-aware DB accessors so the path dispatch below is identical for both
  // trees; the folder-vs-global choice lives only in these one-liners.
  const seriesGroups = () =>
    folderId == null
      ? db.getGlobalSeriesGroups(userId, opts)
      : db.getFolderSeriesGroups(userId, folderId, opts);
  const volumeGroups = (seriesKey: string) =>
    folderId == null
      ? db.getGlobalVolumeGroups(userId, seriesKey, opts)
      : db.getFolderVolumeGroups(userId, folderId, seriesKey, opts);
  const chapterGroups = (seriesKey: string, volumeKey: string) =>
    folderId == null
      ? db.getGlobalChapterGroups(userId, seriesKey, volumeKey, opts)
      : db.getFolderChapterGroups(userId, folderId, seriesKey, volumeKey, opts);
  const volumeComics = (seriesKey: string, volumeKey: string, chapterKey: string | null) => {
    if (!opts.limit) opts.limit = 50;
    return folderId == null
      ? db.getGlobalVolumeComicsForUser(userId, seriesKey, volumeKey, chapterKey, opts)
      : db.getFolderVolumeComicsForUser(userId, folderId, seriesKey, volumeKey, chapterKey, opts);
  };

  if (sub === '/series') {
    sendGroups(res, await seriesGroups());
    return true;
  }

  const volumesMatch = sub.match(/^\/series\/([^/]+)\/volumes$/);
  if (volumesMatch) {
    sendGroups(res, await volumeGroups(decodeURIComponent(volumesMatch[1])));
    return true;
  }

  const chaptersMatch = sub.match(/^\/series\/([^/]+)\/volumes\/([^/]+)\/chapters$/);
  if (chaptersMatch) {
    sendGroups(res, await chapterGroups(decodeURIComponent(chaptersMatch[1]), decodeURIComponent(chaptersMatch[2])));
    return true;
  }

  const volumeComicsMatch = sub.match(/^\/series\/([^/]+)\/volumes\/([^/]+)\/comics$/);
  if (volumeComicsMatch) {
    sendComics(res, await volumeComics(
      decodeURIComponent(volumeComicsMatch[1]),
      decodeURIComponent(volumeComicsMatch[2]),
      null,
    ));
    return true;
  }

  const chapterComicsMatch = sub.match(/^\/series\/([^/]+)\/volumes\/([^/]+)\/chapters\/([^/]+)\/comics$/);
  if (chapterComicsMatch) {
    sendComics(res, await volumeComics(
      decodeURIComponent(chapterComicsMatch[1]),
      decodeURIComponent(chapterComicsMatch[2]),
      decodeURIComponent(chapterComicsMatch[3]),
    ));
    return true;
  }

  return false;
}

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, query, currentUser } = ctx;

  // List folders
  if (method === 'GET' && pathname === '/api/folders') {
    const folders = await db.getAllFolders();
    const safe = folders.map((f) => ({
      id: f.id,
      name: f.name,
      comicCount: f.comicCount,
      mediaType: f.mediaType,
      thumbnailUrl: folderThumbnailUrl(f.id, f.hasCoverThumbnail),
    }));
    sendJson(res, 200, safe);
    return true;
  }

  // Create folder
  if (method === 'POST' && pathname === '/api/folders') {
    if (!requireAdmin(ctx)) return true;
    const parsed = await readJsonBody<{ name?: string; comicIds?: number[] }>(req, res);
    if (!parsed.ok) return true;
    const name = requireTrimmedString(res, parsed.value.name, 'name');
    if (!name) return true;
    const ids = Array.isArray(parsed.value.comicIds) ? parsed.value.comicIds.map(Number) : [];
    sendJson(res, 201, await db.createFolder(name, ids));
    return true;
  }

  const folderIdMatch = pathname.match(/^\/api\/folders\/(\d+)$/);
  // Rename folder
  if (method === 'PUT' && folderIdMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(folderIdMatch[1], 10);
    const parsed = await readJsonBody<{ name?: string }>(req, res);
    if (!parsed.ok) return true;
    const name = requireTrimmedString(res, parsed.value.name, 'name');
    if (!name) return true;
    await db.renameFolder(id, name);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Delete folder
  if (method === 'DELETE' && folderIdMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(folderIdMatch[1], 10);
    await db.deleteFolder(id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const folderComicsMatch = pathname.match(/^\/api\/folders\/(\d+)\/comics$/);

  // Add/remove comics to folder
  if ((method === 'POST' || method === 'DELETE') && folderComicsMatch) {
    if (!requireAdmin(ctx)) return true;
    const folderId = parseInt(folderComicsMatch[1], 10);
    const parsed = await readJsonBody<{ comicIds?: number[] }>(req, res);
    if (!parsed.ok) return true;
    const ids = requireNumberArray(res, parsed.value.comicIds, 'comicIds');
    if (!ids) return true;
    if (method === 'POST') await db.addComicsToFolder(folderId, ids);
    else await db.removeComicsFromFolder(folderId, ids);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Folder thumbnail
  const folderThumbMatch = pathname.match(/^\/api\/folders\/(\d+)\/thumbnail$/);
  if (method === 'GET' && folderThumbMatch) {
    const folderId = parseInt(folderThumbMatch[1], 10);
    const thumb = await db.getFolderThumbnail(folderId);
    if (!thumb || thumb.length === 0) {
      res.writeHead(404);
      res.end();
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': String(thumb.length),
    });
    res.end(thumb);
    return true;
  }

  // Folder-scoped hierarchy: /api/folders/:id/series[/...]. The `/series` guard
  // keeps the flat /api/folders/:id/comics route (below) from being captured.
  const folderHierarchyMatch = pathname.match(/^\/api\/folders\/(\d+)(\/series(?:\/.*)?)$/);
  if (folderHierarchyMatch) {
    const folderId = parseInt(folderHierarchyMatch[1], 10);
    if (await handleHierarchy(ctx, folderId, folderHierarchyMatch[2])) return true;
  }

  // Query folder comics
  if (method === 'GET' && folderComicsMatch) {
    const folderId = parseInt(folderComicsMatch[1], 10);
    const opts = parseFolderRouteOptions(query, folderId);
    const result = await db.queryComicsForUser(currentUser?.id ?? null, opts);
    sendJson(res, 200, formatPagedComicResponse(result));
    return true;
  }

  // Global browse/search hierarchy — same series/volume/chapter tree without a
  // folder scope (folderId null). Used when the search view drills into series.
  if (pathname.startsWith('/api/browse/')) {
    if (await handleHierarchy(ctx, null, pathname.slice('/api/browse'.length))) return true;
  }

  // Rescan folder: derive the common ancestor directory from the folder's
  // comics and re-run ingest against it (additive — existing entries are skipped).
  const folderRescanMatch = pathname.match(/^\/api\/folders\/(\d+)\/rescan$/);
  if (method === 'POST' && folderRescanMatch) {
    if (!requireAdmin(ctx)) return true;
    const folderId = parseInt(folderRescanMatch[1], 10);

    const filePaths = await db.getFolderFilePaths(folderId);
    if (filePaths.length === 0) {
      sendError(res, 400, 'Folder has no comics; cannot derive a scan path');
      return true;
    }

    const dirs = filePaths.map((p) => path.dirname(p));
    const commonDir = findCommonDir(dirs);
    if (!commonDir) {
      sendError(res, 400, 'Comics span multiple root directories; cannot determine scan path');
      return true;
    }

    // Read the last-scan timestamp for incremental mode (only check dirs modified since then).
    const scanMetaKey = folderScanMetaKey(folderId);
    const lastScanRaw = await db.getAppMeta(scanMetaKey);
    const since = lastScanRaw ? parseInt(lastScanRaw, 10) : undefined;
    // Snapshot the start time so we don't miss files added during the scan. The
    // worker persists this as the next incremental cursor once the scan succeeds.
    const scanStartMs = Date.now();

    const jobId = await enqueueScan(
      { targetPath: commonDir, folderId, since, scanMetaTs: scanStartMs },
      { lane: 'normal' },
    );
    if (!jobId) {
      const existing = await db.findActiveScanByPath(commonDir);
      sendJson(res, 200, { jobId: existing?.id ?? null, alreadyQueued: true });
      return true;
    }
    await db.createScanJob({ id: jobId, kind: QUEUE.ingestScan, targetPath: commonDir, folderId });
    sendJson(res, 202, { jobId });
    return true;
  }

  return false;
};
