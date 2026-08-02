import { sendJson, sendError } from '../middleware';
import { requireAdmin, type RouteHandler } from '../context';
import { readJsonBody, requireComic, requireNumberArray, requireTrimmedString } from './validation';
import { diffTags, normalizeTagList, parseTagNameFromPath } from './tagRouteHelpers';

/**
 * @module
 * HTTP Route Handlers for Tags
 *
 * Architecture overview for Junior Devs:
 * Serves the `/api/tags/*` endpoints: listing tags, setting the tags on a comic,
 * and bulk tag operations. Reads are open; mutations are admin-gated. SQL lives
 * in `db/tags.ts`. Returns `true` once it owns the request.
 */

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method } = ctx;

  // List all tags
  if (method === 'GET' && pathname === '/api/tags') {
    sendJson(res, 200, await db.getAllTags());
    return true;
  }

  // Set tags on comic
  const comicTagsMatch = pathname.match(/^\/api\/comics\/(\d+)\/tags$/);
  if (method === 'PUT' && comicTagsMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(comicTagsMatch[1], 10);
    const record = await requireComic(ctx, id);
    if (!record) return true;
    const parsed = await readJsonBody<{ tags?: unknown }>(req, res);
    if (!parsed.ok) return true;
    const normalized = normalizeTagList(parsed.value.tags);
    if (!normalized.ok) { sendError(res, 400, normalized.error); return true; }
    const tagDiff = diffTags(record.tags, normalized.tags);
    for (const tag of tagDiff.removed) await db.removeTag(id, tag);
    for (const tag of tagDiff.added) await db.addTag(id, tag);
    sendJson(res, 200, { ok: true, tags: tagDiff.next });
    return true;
  }

  // Bulk add/remove a single tag across many comics.
  // Match before the catch-all `/api/tags/(.+)` so `name/comics` doesn't get
  // routed into rename/delete.
  const tagBulkMatch = pathname.match(/^\/api\/tags\/([^/]+)\/comics$/);
  if (tagBulkMatch && (method === 'POST' || method === 'DELETE')) {
    if (!requireAdmin(ctx)) return true;
    const tag = parseTagNameFromPath(tagBulkMatch[1]);
    if (!tag) { sendError(res, 400, 'Tag name is empty'); return true; }
    const parsed = await readJsonBody<{ comicIds?: number[] }>(req, res);
    if (!parsed.ok) return true;
    const ids = requireNumberArray(res, parsed.value.comicIds, 'comicIds');
    if (!ids) return true;
    if (method === 'POST') await db.addTagBulk(ids, tag);
    else await db.removeTagBulk(ids, tag);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Rename tag
  const tagNameMatch = pathname.match(/^\/api\/tags\/(.+)$/);
  if (method === 'PUT' && tagNameMatch) {
    if (!requireAdmin(ctx)) return true;
    const oldName = parseTagNameFromPath(tagNameMatch[1]);
    const parsed = await readJsonBody<{ newName?: string }>(req, res);
    if (!parsed.ok) return true;
    const newName = requireTrimmedString(res, parsed.value.newName, 'newName');
    if (!newName) return true;
    await db.renameTag(oldName, newName);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Delete tag
  if (method === 'DELETE' && tagNameMatch) {
    if (!requireAdmin(ctx)) return true;
    const name = parseTagNameFromPath(tagNameMatch[1]);
    await db.deleteTag(name);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
};
