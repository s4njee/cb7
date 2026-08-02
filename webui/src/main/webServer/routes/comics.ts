import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ArchiveLoader from '../../archiveLoader';
import { generateThumbnail, isPlaceholderThumbnail } from '../../thumbnailGenerator';
import { getCachedOrResize, getCachedOrUpscale, invalidateCacheForComic } from '../../imageResizer';
import { upscale } from '../../upscaleClient';
import { searchMetadata } from '../../metadataScraper';
import { sendJson, sendError } from '../middleware';
import { toWebRecord, overlayUserState } from '../mapping';
import { withArchive, evictFromCache } from '../archiveCache';
import { safeFetchBuffer, SafeFetchError } from '../safeFetch';
import { requireAdmin, type RouteHandler } from '../context';
import { FileScannerImpl } from '../../fileScanner';
import { classifyIngestError } from '../../ingestErrorLog';
import { createLogger } from '../../logger';
import { readJsonBody, requireComic } from './validation';
import {
  bookMimeForPath,
  normalizeMetadataGenre,
  parseByteRange,
  pageExtensionForFilename,
  pageMimeForFilename,
  parseComicRouteOptions,
  parseMetadataSources,
  parsePositiveWidthParam,
} from './comicRouteHelpers';
import { formatPagedComicResponse } from './routeResponseHelpers';

/**
 * @module
 * Comics Web API Routes
 * 
 * Architecture overview for Junior Devs:
 * This module exports a single `handle` function which implements the routing logic for all 
 * `/api/comics/*` endpoints using raw Node HTTP `IncomingMessage` and `ServerResponse`.
 * It is responsible for querying the library database, converting internal database types to 
 * web-friendly representations, and managing image extraction/caching (thumbnails and pages) 
 * via the `ArchiveLoader`.
 */

const log = createLogger('webServer:comics');

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, query, currentUser } = ctx;

  // Delete comic (admin)
  const deleteMatch = pathname.match(/^\/api\/comics\/(\d+)$/);
  if (method === 'DELETE' && deleteMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(deleteMatch[1], 10);
    if (!(await db.getComicLite(id))) { sendError(res, 404, 'Comic not found'); return true; }
    await evictFromCache(id);
    await db.removeComics([id]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // List comics
  if (method === 'GET' && pathname === '/api/comics') {
    const opts = parseComicRouteOptions(query);
    const result = await db.queryComicsForUser(currentUser?.id ?? null, opts);
    sendJson(res, 200, formatPagedComicResponse(result));
    return true;
  }

  // Get comic
  const comicMatch = pathname.match(/^\/api\/comics\/(\d+)$/);
  if (method === 'GET' && comicMatch) {
    const id = parseInt(comicMatch[1], 10);
    const record = await db.getComic(id);
    if (!record) { sendError(res, 404, 'Comic not found'); return true; }
    sendJson(res, 200, await overlayUserState(toWebRecord(record)!, db, currentUser?.id ?? null));
    return true;
  }

  // Thumbnail
  const thumbMatch = pathname.match(/^\/api\/comics\/(\d+)\/thumbnail$/);
  if (method === 'GET' && thumbMatch) {
    const id = parseInt(thumbMatch[1], 10);
    const record = await db.getComic(id);
    if (!record) { sendError(res, 404, 'Comic not found'); return true; }
    let thumb = record.coverThumbnail;
    if (record.mediaType === 'comic' && (!thumb || thumb.length === 0 || isPlaceholderThumbnail(thumb))) {
      try {
        await withArchive(id, record.filePath, async (handle) => {
          const cover = await ArchiveLoader.getCoverImage(handle);
          thumb = await generateThumbnail(cover);
          await db.updateCoverThumbnailByPath(record.filePath, thumb);
          invalidateCacheForComic(id);
        });
      } catch (err) {
        log.warn(`Thumbnail recover failed comic=${id}:`, err);
        const message = (err instanceof Error ? err.message : String(err)).trim();
        // Best-effort: logging the failure must never break the response.
        await db.recordIngestError({
          path: record.filePath,
          ext: path.extname(record.filePath).toLowerCase(),
          errorClass: classifyIngestError(err, record.filePath),
          message,
        }).catch(() => {});
      }
    }
    if (!thumb || thumb.length === 0) {
      const placeholder = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' });
      res.end(placeholder);
      return true;
    }
    const resolvedThumb = thumb;
    const widthParam = parsePositiveWidthParam(query.width);
    if (widthParam !== null) {
      try {
        const out = await getCachedOrResize(id, -1, widthParam, async () => ({ buffer: resolvedThumb, ext: 'jpg' }));
        res.writeHead(200, {
          'Content-Type': `image/${out.ext}`,
          'Cache-Control': 'public, max-age=3600',
          'Content-Length': String(out.buffer.length),
        });
        res.end(out.buffer);
        return true;
      } catch (err) {
        log.warn('Thumbnail resize failed, falling back:', err);
      }
    }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': String(resolvedThumb.length),
    });
    res.end(resolvedThumb);
    return true;
  }

  // Pages
  const pageMatch = pathname.match(/^\/api\/comics\/(\d+)\/pages\/(\d+)$/);
  if (method === 'GET' && pageMatch) {
    const comicId = parseInt(pageMatch[1], 10);
    const pageIndex = parseInt(pageMatch[2], 10);
    // Lite fetch: page serving only needs the file path/media type — the full
    // record would drag the cover blob + a tags query along on every page turn.
    const record = await db.getComicLite(comicId);
    if (!record) { sendError(res, 404, 'Comic not found'); return true; }
    if (record.mediaType !== 'comic') { sendError(res, 400, 'Not a comic archive'); return true; }
    try {
      await withArchive(comicId, record.filePath, async (handle) => {
        if (pageIndex < 0 || pageIndex >= handle.pageCount) {
          sendError(res, 400, `Page ${pageIndex} out of range`);
          return;
        }
        const ext = pageExtensionForFilename(handle.entries[pageIndex]?.filename);
        const mime = pageMimeForFilename(handle.entries[pageIndex]?.filename);

        // HD upscale (Real-ESRGAN, comics only). Serves the 2x page; the helper
        // caches it and falls back to a normal page if the GPU service is down.
        if (query.upscale === '1') {
          try {
            const out = await getCachedOrUpscale(comicId, pageIndex, async () => {
              const buf = await ArchiveLoader.getPage(handle, pageIndex);
              return { buffer: buf, ext };
            }, upscale);
            res.writeHead(200, {
              'Content-Type': `image/${out.ext}`,
              'Cache-Control': 'public, max-age=86400',
              'Content-Length': String(out.buffer.length),
            });
            res.end(out.buffer);
            return;
          } catch (err) {
            log.warn('Page upscale failed, falling back:', err);
          }
        }

        const widthParam = parsePositiveWidthParam(query.width);
        if (widthParam !== null) {
          try {
            const out = await getCachedOrResize(comicId, pageIndex, widthParam, async () => {
              const buf = await ArchiveLoader.getPage(handle, pageIndex);
              return { buffer: buf, ext };
            });
            res.writeHead(200, {
              'Content-Type': `image/${out.ext}`,
              'Cache-Control': 'public, max-age=86400',
              'Content-Length': String(out.buffer.length),
            });
            res.end(out.buffer);
            return;
          } catch (err) {
            log.warn('Page resize failed, falling back:', err);
          }
        }

        const buf = await ArchiveLoader.getPage(handle, pageIndex);
        res.writeHead(200, {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=86400',
          'Content-Length': String(buf.length),
        });
        res.end(buf);
      });
    } catch (err) {
      log.error(`Page read error comic=${comicId} page=${pageIndex}:`, err);
      const message = (err instanceof Error ? err.message : String(err)).trim();
      // Best-effort: logging the failure must never break the response.
      await db.recordIngestError({
        path: record.filePath,
        ext: path.extname(record.filePath).toLowerCase(),
        errorClass: classifyIngestError(err, record.filePath),
        message,
      }).catch(() => {});
      if (!res.headersSent) sendError(res, 500, 'Failed to read page');
    }
    return true;
  }

  // Book file stream
  const fileMatch = pathname.match(/^\/api\/comics\/(\d+)\/file$/);
  if (method === 'GET' && fileMatch) {
    const id = parseInt(fileMatch[1], 10);
    const record = await db.getComicLite(id);
    if (!record) { sendError(res, 404, 'Comic not found'); return true; }
    if (record.mediaType !== 'book') { sendError(res, 400, 'Not a book'); return true; }
    const mime = bookMimeForPath(record.filePath);
    try {
      const stat = fs.statSync(record.filePath);
      const total = stat.size;

      // Honor HTTP Range requests so pdf.js (and other clients) can fetch the
      // file progressively instead of downloading the whole thing up front.
      // Without this, opening a large PDF over the network blocks on a full
      // transfer before the first page can render.
      const range = parseByteRange(req.headers.range, total);
      if (range === 'invalid') {
        res.writeHead(416, {
          'Content-Range': `bytes */${total}`,
          'Content-Type': mime,
        });
        res.end();
        return true;
      }

      const start = range ? range.start : 0;
      const end = range ? range.end : total - 1;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(record.filePath, range ? { start, end } : undefined);
      stream.on('error', (streamErr) => {
        log.error(`File stream error id=${id}:`, streamErr);
        stream.destroy();
        res.destroy();
      });
      res.writeHead(range ? 206 : 200, {
        'Content-Type': mime,
        'Content-Length': String(chunkSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
      });
      stream.pipe(res);
    } catch (err) {
      log.error(`File read error id=${id}:`, err);
      sendError(res, 500, 'Failed to read file');
    }
    return true;
  }

  // Metadata search
  const metadataSearchMatch = pathname.match(/^\/api\/comics\/(\d+)\/metadata-search$/);
  if (method === 'GET' && metadataSearchMatch) {
    if (!requireAdmin(ctx)) return true;
    const q = typeof query.q === 'string' ? query.q : '';
    const srcsRaw = typeof query.sources === 'string' ? query.sources : '';
    const srcs = parseMetadataSources(srcsRaw);
    const result = await searchMetadata(q, srcs.length ? srcs : undefined);
    sendJson(res, 200, result);
    return true;
  }

  // Metadata apply
  const metadataPutMatch = pathname.match(/^\/api\/comics\/(\d+)\/metadata$/);
  if (method === 'PUT' && metadataPutMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(metadataPutMatch[1], 10);
    if (!(await requireComic(ctx, id))) return true;
    const parsed = await readJsonBody<{
      title?: string; author?: string | null; artist?: string | null;
      genre?: string | string[] | null; year?: number | null; summary?: string | null;
      externalId?: string | null; externalSource?: string | null;
      seriesName?: string | null; volumeNumber?: number | null; chapterNumber?: number | null;
      coverUrl?: string | null;
    }>(req, res);
    if (!parsed.ok) return true;
    const metadata = parsed.value;
    const genre = normalizeMetadataGenre(metadata.genre);
    if (!genre.ok) { sendError(res, 400, genre.error); return true; }
    await db.updateComicMetadata(id, {
      title: metadata.title,
      author: metadata.author,
      artist: metadata.artist,
      genre: genre.value,
      year: metadata.year,
      summary: metadata.summary,
      externalId: metadata.externalId,
      externalSource: metadata.externalSource,
      seriesName: metadata.seriesName,
      volumeNumber: metadata.volumeNumber,
      chapterNumber: metadata.chapterNumber,
    });
    if (typeof metadata.coverUrl === 'string' && metadata.coverUrl) {
      try {
        const buf = await safeFetchBuffer(metadata.coverUrl);
        const thumb = await generateThumbnail(buf);
        const record = await db.getComic(id);
        if (record && thumb) await db.updateCoverThumbnailByPath(record.filePath, thumb);
        invalidateCacheForComic(id);
      } catch (err) {
        if (err instanceof SafeFetchError) {
          log.warn(`Cover fetch refused for comic=${id}: ${err.message}`);
        } else {
          log.warn(`Cover fetch failed for comic=${id}:`, err);
        }
      }
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Refresh book metadata (re-derive page count + cover from the file on
  // disk for an already-indexed book). PDFs whose pageCount is still 0
  // are the typical case — the original ingest may have timed out.
  const refreshMatch = pathname.match(/^\/api\/comics\/(\d+)\/refresh-metadata$/);
  if (method === 'POST' && refreshMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(refreshMatch[1], 10);
    const record = await db.getComic(id);
    if (!record) { sendError(res, 404, 'Comic not found'); return true; }
    if (record.mediaType !== 'book') {
      sendJson(res, 200, await overlayUserState(toWebRecord(record)!, db, currentUser?.id ?? null));
      return true;
    }
    if (record.pageCount <= 0) {
      const scanner = new FileScannerImpl(db);
      try {
        await scanner.refreshBookMetadata(record.filePath);
      } catch (err) {
        log.warn(`refreshBookMetadata failed for comic=${id}:`, err);
      }
    }
    const fresh = await db.getComic(id);
    if (!fresh) { sendError(res, 404, 'Comic not found'); return true; }
    sendJson(res, 200, await overlayUserState(toWebRecord(fresh)!, db, currentUser?.id ?? null));
    return true;
  }

  return false;
};
