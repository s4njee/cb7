import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ArchiveLoader from '../../archiveLoader';
import { generateThumbnail, isPlaceholderThumbnail } from '../../thumbnailGenerator';
import { getCachedOrResize, getCachedOrUpscale, invalidateCacheForComic } from '../../imageResizer';
import { upscale } from '../../upscaleClient';
import { sendError } from '../middleware';
import { withArchive } from '../archiveCache';
import { type RouteHandler } from '../context';
import { classifyIngestError } from '../../ingestErrorLog';
import { createLogger } from '../../logger';
import { requireComicLite } from './validation';
import {
  bookMimeForPath,
  parseByteRange,
  pageExtensionForFilename,
  pageMimeForFilename,
  parsePositiveWidthParam,
} from './comicRouteHelpers';

/**
 * @module
 * Comic Media Serving Routes (Thumbnails, Archive Pages, Book File Streams)
 */

const log = createLogger('webServer:comicMedia');

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, query } = ctx;

  // 1. Thumbnail
  const thumbMatch = pathname.match(/^\/api\/comics\/(\d+)\/thumbnail$/);
  if (method === 'GET' && thumbMatch) {
    const id = parseInt(thumbMatch[1], 10);
    const record = await requireComicLite(ctx, id);
    if (!record) return true;

    let thumb = await db.getComicCover(id);
    if (!thumb) thumb = (await db.getComic(id))?.coverThumbnail ?? null;
    if (record.mediaType === 'comic' && (!thumb || thumb.length === 0 || isPlaceholderThumbnail(thumb))) {
      try {
        await withArchive(id, record.filePath, async (handle) => {
          const cover = await ArchiveLoader.getCoverImage(handle);
          thumb = await generateThumbnail(cover);
          await db.setComicCover(id, thumb);
          invalidateCacheForComic(id);
        });
      } catch (err) {
        log.warn(`Thumbnail recover failed comic=${id}:`, err);
        const message = (err instanceof Error ? err.message : String(err)).trim();
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

  // 2. Archive Pages
  const pageMatch = pathname.match(/^\/api\/comics\/(\d+)\/pages\/(\d+)$/);
  if (method === 'GET' && pageMatch) {
    const comicId = parseInt(pageMatch[1], 10);
    const pageIndex = parseInt(pageMatch[2], 10);

    const record = await requireComicLite(ctx, comicId);
    if (!record) return true;
    if (record.mediaType !== 'comic') { sendError(res, 400, 'Not a comic archive'); return true; }
    try {
      await withArchive(comicId, record.filePath, async (handle) => {
        if (pageIndex < 0 || pageIndex >= handle.pageCount) {
          sendError(res, 400, `Page ${pageIndex} out of range`);
          return;
        }
        const ext = pageExtensionForFilename(handle.entries[pageIndex]?.filename);
        const mime = pageMimeForFilename(handle.entries[pageIndex]?.filename);

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
      // P1-8: the file vanished from disk — badge the row as missing and answer
      // 404 so the reader shows a clear "file is gone" state rather than a 500.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        await db.markComicMissing(comicId).catch(() => {});
        sendError(res, 404, 'File is missing from disk');
        return true;
      }
      const message = (err instanceof Error ? err.message : String(err)).trim();
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

  // 3. Book File Stream
  const fileMatch = pathname.match(/^\/api\/comics\/(\d+)\/file$/);
  if (method === 'GET' && fileMatch) {
    const id = parseInt(fileMatch[1], 10);
    const record = await requireComicLite(ctx, id);
    if (!record) return true;
    if (record.mediaType !== 'book') { sendError(res, 400, 'Not a book'); return true; }
    const mime = bookMimeForPath(record.filePath);
    try {
      const stat = await fs.promises.stat(record.filePath);
      const total = stat.size;

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
      res.on('close', () => {
        stream.destroy();
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
      // P1-8: the file vanished from disk — badge the row as missing and answer
      // 404 so the reader shows a clear "file is gone" state rather than a 500.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        await db.markComicMissing(id).catch(() => {});
        sendError(res, 404, 'File is missing from disk');
        return true;
      }
      sendError(res, 500, 'Failed to read file');
    }
    return true;
  }

  return false;
};
