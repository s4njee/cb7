import { sendJson, sendError, parseQueryOptions } from '../middleware';
import { requireAdmin, type RouteHandler } from '../context';
import { readJsonBody, requireNumberArray, requireTrimmedString } from './validation';
import { buildLibraryComicQueryOptions, mediaTypeForNewLibrary } from './libraryRouteHelpers';
import { formatPagedComicResponse } from './routeResponseHelpers';

/**
 * @module
 * HTTP Route Handlers for Libraries
 *
 * Architecture overview for Junior Devs:
 * Serves the `/api/libraries/*` endpoints. A "library" is a named, media-typed
 * bucket (comic vs book) that groups comics and folders. This handler covers
 * listing libraries, reading a library's contents, and the admin actions that
 * create one or change its membership. SQL lives in `db/libraries.ts`; this file
 * is about request shape, auth gating, and JSON responses. Returns `true` once it
 * owns the request.
 */

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, query, currentUser } = ctx;

  // List libraries
  if (method === 'GET' && pathname === '/api/libraries') {
    const mediaType = query.mediaType as 'comic' | 'book' | undefined;
    sendJson(res, 200, await db.getAllLibraries(mediaType));
    return true;
  }

  // Create library
  if (method === 'POST' && pathname === '/api/libraries') {
    if (!requireAdmin(ctx)) return true;
    const parsed = await readJsonBody<{ name?: unknown; mediaType?: unknown }>(req, res);
    if (!parsed.ok) return true;
    const name = requireTrimmedString(res, parsed.value.name, 'name');
    if (!name) return true;
    const mediaType = mediaTypeForNewLibrary(parsed.value.mediaType);
    try {
      sendJson(res, 201, await db.createLibrary(name, mediaType));
    } catch {
      sendError(res, 409, 'A collection with that name already exists');
    }
    return true;
  }

  const libRenameMatch = pathname.match(/^\/api\/libraries\/(\d+)$/);
  // Rename library
  if (method === 'PUT' && libRenameMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(libRenameMatch[1], 10);
    const parsed = await readJsonBody<{ name?: string }>(req, res);
    if (!parsed.ok) return true;
    const name = requireTrimmedString(res, parsed.value.name, 'name');
    if (!name) return true;
    try {
      await db.renameLibrary(id, name);
      sendJson(res, 200, { ok: true });
    } catch {
      sendError(res, 409, 'A collection with that name already exists');
    }
    return true;
  }

  // Delete library
  if (method === 'DELETE' && libRenameMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(libRenameMatch[1], 10);
    await db.deleteLibrary(id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const libComicsMatch = pathname.match(/^\/api\/libraries\/(\d+)\/comics$/);

  // Remove comics from library
  if (method === 'DELETE' && libComicsMatch) {
    if (!requireAdmin(ctx)) return true;
    const libId = parseInt(libComicsMatch[1], 10);
    const parsed = await readJsonBody<{ comicIds?: number[] }>(req, res);
    if (!parsed.ok) return true;
    const comicIds = requireNumberArray(res, parsed.value.comicIds, 'comicIds');
    if (!comicIds) return true;
    await db.removeComicsFromLibrary(libId, comicIds);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Add comics to library
  if (method === 'POST' && libComicsMatch) {
    if (!requireAdmin(ctx)) return true;
    const libId = parseInt(libComicsMatch[1], 10);
    const parsed = await readJsonBody<{ comicIds?: number[] }>(req, res);
    if (!parsed.ok) return true;
    const comicIds = requireNumberArray(res, parsed.value.comicIds, 'comicIds');
    if (!comicIds) return true;
    await db.addComicsToLibrary(libId, comicIds);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Add folders (whole-folder import) to library
  const libFoldersMatch = pathname.match(/^\/api\/libraries\/(\d+)\/folders$/);
  if (method === 'POST' && libFoldersMatch) {
    if (!requireAdmin(ctx)) return true;
    const libId = parseInt(libFoldersMatch[1], 10);
    const parsed = await readJsonBody<{ folderIds?: number[] }>(req, res);
    if (!parsed.ok) return true;
    const folderIds = requireNumberArray(res, parsed.value.folderIds, 'folderIds');
    if (!folderIds) return true;
    await db.addFoldersToLibrary(libId, folderIds);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Query comics in library
  if (method === 'GET' && libComicsMatch) {
    const libId = parseInt(libComicsMatch[1], 10);
    const opts = buildLibraryComicQueryOptions(parseQueryOptions(query), query, libId);
    const result = await db.queryComicsForUser(currentUser?.id ?? null, opts);
    sendJson(res, 200, formatPagedComicResponse(result));
    return true;
  }

  return false;
};
