import { generateThumbnail } from '../../thumbnailGenerator';
import { invalidateCacheForComic } from '../../imageResizer';
import { searchMetadata } from '../../metadataScraper';
import { sendJson, sendError } from '../middleware';
import { toWebRecord, overlayUserState } from '../mapping';
import { safeFetchBuffer, SafeFetchError } from '../safeFetch';
import { requireAdmin, type RouteHandler } from '../context';
import { FileScannerImpl } from '../../fileScanner';
import { createLogger } from '../../logger';
import type { ComicMetadataUpdateFields } from '../../db/comicMetadataHelpers';
import { readJsonBody, requireComic, requireNumberArray } from './validation';
import { withArchive } from '../archiveCache';
import { readComicInfoFromArchive, type EmbeddedMetadata } from '../../embeddedMetadata';
import { extractEpubMetadata } from '../../epubCoverExtractor';
import {
  normalizeMetadataGenre,
  parseMetadataSources,
} from './comicRouteHelpers';

/**
 * @module
 * Comic Metadata Search, Update & Refresh Routes
 */

const log = createLogger('webServer:comicMetadata');

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, query, currentUser } = ctx;

  // 1. Metadata search
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

  // 2. Metadata apply
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
        if (record && thumb) await db.setComicCover(id, thumb);
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

  // 3. Refresh book metadata
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

  // 4. Batch metadata apply (admin): update many comics in one request. Only
  //    the fields present in the body are written (undefined = leave unchanged);
  //    an explicit `null` clears a field. Tags, when provided, replace the full
  //    tag set on every id.
  if (method === 'PUT' && pathname === '/api/comics/batch-metadata') {
    if (!requireAdmin(ctx)) return true;
    const parsed = await readJsonBody<{ ids?: unknown; fields?: Record<string, unknown> }>(req, res);
    if (!parsed.ok) return true;
    const ids = requireNumberArray(res, parsed.value.ids, 'ids');
    if (!ids) return true;
    if (ids.length > 5000) { sendError(res, 400, 'Too many ids (max 5000)'); return true; }

    const fields = parsed.value.fields ?? {};
    const metadataFields: ComicMetadataUpdateFields = {};
    let tags: string[] | undefined;

    if (fields.author !== undefined) {
      if (fields.author !== null && typeof fields.author !== 'string') {
        sendError(res, 400, '"author" must be a string or null'); return true;
      }
      metadataFields.author = fields.author;
    }
    if (fields.seriesName !== undefined) {
      if (fields.seriesName !== null && typeof fields.seriesName !== 'string') {
        sendError(res, 400, '"seriesName" must be a string or null'); return true;
      }
      metadataFields.seriesName = fields.seriesName;
    }
    if (fields.volumeNumber !== undefined) {
      if (fields.volumeNumber !== null && (typeof fields.volumeNumber !== 'number' || !Number.isFinite(fields.volumeNumber))) {
        sendError(res, 400, '"volumeNumber" must be a number or null'); return true;
      }
      metadataFields.volumeNumber = fields.volumeNumber;
    }
    if (fields.year !== undefined) {
      if (fields.year !== null && (typeof fields.year !== 'number' || !Number.isFinite(fields.year))) {
        sendError(res, 400, '"year" must be a number or null'); return true;
      }
      metadataFields.year = fields.year;
    }
    if (fields.summary !== undefined) {
      if (fields.summary !== null && typeof fields.summary !== 'string') {
        sendError(res, 400, '"summary" must be a string or null'); return true;
      }
      metadataFields.summary = fields.summary;
    }
    if (fields.genre !== undefined) {
      const genre = normalizeMetadataGenre(fields.genre);
      if (!genre.ok) { sendError(res, 400, genre.error); return true; }
      metadataFields.genre = genre.value;
    }
    if (fields.tags !== undefined) {
      if (!Array.isArray(fields.tags) || !fields.tags.every((t) => typeof t === 'string')) {
        sendError(res, 400, '"tags" must be an array of strings'); return true;
      }
      tags = fields.tags;
    }

    await db.updateComicMetadataBulk(ids, metadataFields);
    if (tags !== undefined) await db.replaceTagsForComics(ids, tags);
    sendJson(res, 200, { ok: true, updated: ids.length });
    return true;
  }

  // 5. Re-read embedded metadata (admin): re-read the file's own metadata
  //    (ComicInfo.xml from CBZ/CBR archives, the EPUB OPF) and fill only the
  //    fields currently NULL. Responds with the map of what actually changed
  //    (`fields`) so the UI can tell the user what was applied.
  const refreshEmbeddedMatch = pathname.match(/^\/api\/comics\/(\d+)\/refresh-embedded-metadata$/);
  if (method === 'POST' && refreshEmbeddedMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(refreshEmbeddedMatch[1], 10);
    const record = await requireComic(ctx, id);
    if (!record) return true;

    let embedded: EmbeddedMetadata | null = null;
    if (record.mediaType === 'comic') {
      embedded = await withArchive(id, record.filePath, async (handle) => readComicInfoFromArchive(handle));
    } else if (record.mediaType === 'book' && record.filePath.toLowerCase().endsWith('.epub')) {
      embedded = await extractEpubMetadata(record.filePath).catch(() => null);
    }
    // PDFs and other book formats carry no embedded metadata we read; a
    // comic/epub with no readable metadata is also a no-op.
    if (!embedded) {
      sendJson(res, 200, { ok: true, fields: {} });
      return true;
    }

    const fields = await db.fillNullMetadataFromEmbedded(id, embedded);
    sendJson(res, 200, { ok: true, fields });
    return true;
  }

  return false;
};
