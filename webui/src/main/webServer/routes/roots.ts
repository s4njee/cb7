import * as fs from 'node:fs';
import { sendJson, sendError } from '../middleware';
import { requireAdmin, type RouteHandler } from '../context';
import type { LibraryDatabase } from '../../libraryDatabase';
import { enqueueScan } from '../../jobs/producer';
import { readJsonBody } from './validation';
import {
  folderScanMetaKey,
  resolveScanTarget,
} from './folderRouteHelpers';

/**
 * @module
 * Watched Roots & Folder Ingest API Routes
 *
 * Architecture overview for Junior Devs:
 * Watched roots allow folders to automatically monitor directory paths on disk
 * and enqueue background scan jobs through pg-boss.
 */

async function enqueueFolderScan(
  db: LibraryDatabase,
  folderId: number,
  targetPath: string,
): Promise<string | null> {
  const jobId = await enqueueScan({ targetPath, folderId }, { lane: 'high' });
  if (jobId) {
    await db.setAppMeta(folderScanMetaKey(folderId), String(Date.now()));
  }
  return jobId;
}

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method } = ctx;

  // 1. Rescan a single folder (enqueues a background scan)
  const rescanMatch = pathname.match(/^\/api\/folders\/(\d+)\/rescan$/);
  if (method === 'POST' && rescanMatch) {
    if (!requireAdmin(ctx)) return true;
    const folderId = parseInt(rescanMatch[1], 10);
    if (!(await db.folderExists(folderId))) { sendError(res, 404, 'Folder not found'); return true; }

    const target = resolveScanTarget({
      scanPath: await db.getFolderScanRoot(folderId),
      filePaths: await db.getFolderFilePaths(folderId),
    });
    if (!target) {
      sendError(res, 400, 'Folder has no registered scan root and no comics to derive one from');
      return true;
    }
    if (!fs.existsSync(target.targetPath)) {
      sendError(res, 400, `Scan path does not exist: ${target.targetPath}`);
      return true;
    }

    const jobId = await enqueueFolderScan(db, folderId, target.targetPath);
    if (!jobId) {
      const existing = await db.findActiveScanByPath(target.targetPath);
      sendJson(res, 200, { jobId: existing?.id ?? null, alreadyQueued: true });
      return true;
    }
    sendJson(res, 202, { jobId });
    return true;
  }

  // 2. List watched roots with their scan status
  if (method === 'GET' && pathname === '/api/roots') {
    if (!requireAdmin(ctx)) return true;
    const roots = await db.getWatchedRoots();
    const latestJobs = await db.getLatestScanJobForFolders(roots.map((r) => r.id));
    const items = [];
    for (const root of roots) {
      const job = latestJobs.get(root.id);
      const lastScanRaw = await db.getAppMeta(folderScanMetaKey(root.id));
      items.push({
        folderId: root.id,
        name: root.name,
        scanPath: root.scanPath,
        enabled: root.autoScanEnabled,
        comicCount: root.comicCount,
        pathExists: fs.existsSync(root.scanPath),
        lastScanAt: lastScanRaw ? parseInt(lastScanRaw, 10) : null,
        lastScanJob: job
          ? { status: job.status, error: job.error, added: job.added, updatedAt: job.updatedAt }
          : null,
      });
    }
    sendJson(res, 200, items);
    return true;
  }

  // 3. Update a root: set/clear scan path and/or auto-scan
  const rootMatch = pathname.match(/^\/api\/roots\/(\d+)$/);
  if (method === 'PUT' && rootMatch) {
    if (!requireAdmin(ctx)) return true;
    const folderId = parseInt(rootMatch[1], 10);
    if (!(await db.folderExists(folderId))) { sendError(res, 404, 'Folder not found'); return true; }
    const parsed = await readJsonBody<{ scanPath?: unknown; enabled?: unknown }>(req, res);
    if (!parsed.ok) return true;
    const { scanPath, enabled } = parsed.value;

    let newlyRegistered: string | null = null;
    if (scanPath !== undefined) {
      const trimmed = typeof scanPath === 'string' ? scanPath.trim() : '';
      const previous = await db.getFolderScanRoot(folderId);
      if (trimmed === '') {
        await db.setFolderScanRoot(folderId, null);
      } else {
        await db.setFolderScanRoot(folderId, trimmed);
        if (previous !== trimmed) newlyRegistered = trimmed;
      }
    }
    if (enabled !== undefined) {
      await db.setFolderAutoScanEnabled(folderId, enabled === true);
    }

    let jobId: string | null = null;
    let alreadyQueued = false;
    if (newlyRegistered && fs.existsSync(newlyRegistered)) {
      jobId = await enqueueFolderScan(db, folderId, newlyRegistered);
      alreadyQueued = jobId == null;
    }
    sendJson(res, 200, { ok: true, jobId, alreadyQueued });
    return true;
  }

  // 4. Remove watch
  if (method === 'DELETE' && rootMatch) {
    if (!requireAdmin(ctx)) return true;
    const folderId = parseInt(rootMatch[1], 10);
    await db.setFolderScanRoot(folderId, null);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // 5. Rescan all enabled watched roots
  if (method === 'POST' && pathname === '/api/roots/rescan-all') {
    if (!requireAdmin(ctx)) return true;
    const roots = (await db.getWatchedRoots()).filter((r) => r.autoScanEnabled);
    const jobs: Array<{ folderId: number; jobId: string | null; alreadyQueued: boolean }> = [];
    let enqueued = 0;
    for (const root of roots) {
      if (!fs.existsSync(root.scanPath)) continue;
      const jobId = await enqueueFolderScan(db, root.id, root.scanPath);
      if (jobId) enqueued += 1;
      jobs.push({ folderId: root.id, jobId, alreadyQueued: jobId == null });
    }
    sendJson(res, 200, { enqueued, jobs });
    return true;
  }

  return false;
};
