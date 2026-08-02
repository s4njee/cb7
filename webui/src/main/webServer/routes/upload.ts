import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { sendJson, sendError, isHostConnection } from '../middleware';
import { addSingleFile } from '../ingest';
import { requireAdmin, type RouteHandler } from '../context';
import type { IngestErrorLogResponse } from '../../../shared/apiTypes';
import { readJsonBody, requireTrimmedString } from './validation';
import { enqueueScan } from '../../jobs/producer';
import { QUEUE } from '../../jobs/queues';
import {
  directorySuggestions,
  parseIngestErrorLimit,
  resolveAddPathFolderTarget,
  parseUploadHeaders,
  resolveDirectoryLookup,
  resolveUploadDestination,
  validateUploadPathParts,
} from './uploadRouteHelpers';

/**
 * @module
 * Web API Routes for Ingest and Uploads
 * 
 * Architecture overview for Junior Devs:
 * This module handles admin endpoints related to getting files into the system:
 * - Native file pickers (`/api/admin/pick-path`) via Electron dialogs.
 * - Direct file uploads (`/api/admin/upload`) which stream directly to disk.
 * - Initiating background ingest tasks (`/api/admin/ingest`).
 * 
 * Security:
 * These endpoints interact directly with the host filesystem. Thus, they must be strictly
 * guarded by `requireAdmin(ctx)`. Path inputs are sanitized to prevent directory traversal.
 */

let uploadRootDir: string | null = null;

/**
 * Wire up where uploaded files land (typically `<userData>/web-uploads`).
 * When unset, falls back to a tmpdir-scoped path so tests / standalone
 * smoke tests don't crash.
 */
export function setUploadRoot(dir: string): void {
  uploadRootDir = dir;
}

function uploadRoot(): string {
  return path.join(uploadRootDir ?? path.join(os.tmpdir(), 'cb8'), 'web-uploads');
}

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, query } = ctx;

  // Admin: host info
  if (method === 'GET' && pathname === '/api/admin/host-info') {
    if (!requireAdmin(ctx)) return true;
    sendJson(res, 200, { homePath: os.homedir() });
    return true;
  }

  // Admin: native pick-path — only ever worked inside the (now-removed) Electron
  // desktop app's native file dialog. The server has no host UI, so report it
  // unavailable; web admins add files through the upload route below instead.
  if (method === 'POST' && pathname === '/api/admin/pick-path') {
    if (!requireAdmin(ctx)) return true;
    if (!isHostConnection(req)) { sendError(res, 403, 'Host-only operation'); return true; }
    sendError(res, 503, 'Native file picker is unavailable in this server build');
    return true;
  }

  // Admin: upload file (streaming raw body)
  if (method === 'POST' && pathname === '/api/admin/upload') {
    if (!requireAdmin(ctx)) return true;

    const parsedHeaders = parseUploadHeaders(req.headers['x-cb8-filename'], req.headers['x-cb8-relpath']);
    if (!parsedHeaders.ok) { sendError(res, parsedHeaders.status, parsedHeaders.error); return true; }
    const pathParts = validateUploadPathParts(parsedHeaders.filename, parsedHeaders.relPath);
    if (!pathParts.ok) { sendError(res, pathParts.status, pathParts.error); return true; }

    const baseDir = uploadRoot();
    const destPath = resolveUploadDestination(baseDir, pathParts.relParts);
    if (!destPath) {
      sendError(res, 400, 'Resolved path escapes upload directory'); return true;
    }

    try {
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
    } catch (err) {
      sendError(res, 500, err instanceof Error ? err.message : String(err)); return true;
    }

    if (await db.comicExistsByPath(destPath)) {
      req.resume();
      await new Promise<void>((resolve) => req.on('end', () => resolve()).on('error', () => resolve()));
      sendJson(res, 200, { added: false, skipped: true, reason: 'Already in library', filePath: destPath });
      return true;
    }

    const writeStream = fs.createWriteStream(destPath);
    try {
      await new Promise<void>((resolve, reject) => {
        req.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', () => resolve());
        req.pipe(writeStream);
      });
    } catch (err) {
      writeStream.destroy();
      await fsp.unlink(destPath).catch(() => {});
      sendError(res, 500, `Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }

    const result = await addSingleFile(db, destPath);
    if (!result.added && result.error) {
      await fsp.unlink(destPath).catch(() => {});
      sendError(res, 500, result.error);
      return true;
    }
    sendJson(res, 200, { added: result.added, filePath: destPath });
    return true;
  }

  // Admin: list directory
  if (method === 'GET' && pathname === '/api/admin/list-dir') {
    if (!requireAdmin(ctx)) return true;
    const raw = typeof query.path === 'string' ? query.path : '';
    if (!raw) { sendJson(res, 200, { dir: '', entries: [] }); return true; }

    const { dir, prefix } = resolveDirectoryLookup(raw);

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const matches = directorySuggestions(dir, prefix, entries);
      sendJson(res, 200, { dir, entries: matches });
    } catch (err) {
      sendError(res, 400, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  // Admin: read ingest-error log. Returns the total count plus the N most
  // recent records (newest first). Backing store is the shared `ingest_errors`
  // Postgres table, so this reports failures from both the API and the worker.
  if (method === 'GET' && pathname === '/api/admin/ingest-errors') {
    if (!requireAdmin(ctx)) return true;
    const limit = parseIngestErrorLimit(ctx.query.limit);
    const body: IngestErrorLogResponse = {
      count: await db.countIngestErrors(),
      recent: await db.getRecentIngestErrors(limit),
    };
    sendJson(res, 200, body);
    return true;
  }

  // Admin: truncate the ingest-error log.
  if (method === 'DELETE' && pathname === '/api/admin/ingest-errors') {
    if (!requireAdmin(ctx)) return true;
    await db.clearIngestErrors();
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Admin: wipe the library catalog. Users, sessions, and app settings
  // are preserved; only media-related rows (comics, tags, libraries,
  // folders, per-user state, dismissed paths) are removed. Files on
  // disk are not touched.
  if (method === 'DELETE' && pathname === '/api/admin/library') {
    if (!requireAdmin(ctx)) return true;
    try {
      // clearLibrary() is async (Postgres transaction); awaiting ensures the
      // wipe completes before responding and that `removed` is the real row
      // counts rather than an unresolved Promise (which serialized to {}).
      const removed = await db.clearLibrary();
      sendJson(res, 200, { ok: true, removed });
    } catch (err) {
      sendError(res, 500, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  // Admin: add path — enqueue a durable background scan job and return its id.
  // The browser polls GET /api/jobs/:id for progress; the cb8-worker runs it.
  if (method === 'POST' && pathname === '/api/admin/add-path') {
    if (!requireAdmin(ctx)) return true;
    const parsed = await readJsonBody<{ path?: unknown; folderName?: unknown; useFolderNamesAsSeries?: unknown }>(req, res, 64 * 1024);
    if (!parsed.ok) return true;
    const targetPath = requireTrimmedString(res, parsed.value.path, 'path');
    if (!targetPath) return true;

    // Resolve optional folder target. Implicit create-if-no-match: a name
    // that doesn't case-insensitively match an existing folder creates one.
    let folderId: number | undefined;
    const folderTarget = resolveAddPathFolderTarget(parsed.value.folderName, await db.getAllFolders());
    if (folderTarget.kind === 'existing') folderId = folderTarget.id;
    else if (folderTarget.kind === 'create') folderId = (await db.createFolder(folderTarget.name, [])).id;

    const jobId = await enqueueScan(
      { targetPath, folderId, useFolderNamesAsSeries: parsed.value.useFolderNamesAsSeries === true },
      { lane: 'normal' },
    );
    // null → a scan of this path is already queued/active (singletonKey dedupe).
    if (!jobId) {
      const existing = await db.findActiveScanByPath(targetPath);
      sendJson(res, 200, { jobId: existing?.id ?? null, alreadyQueued: true });
      return true;
    }
    // Create the progress row now so the client can poll immediately.
    await db.createScanJob({ id: jobId, kind: QUEUE.ingestScan, targetPath, folderId: folderId ?? null });
    sendJson(res, 202, { jobId });
    return true;
  }

  return false;
};
