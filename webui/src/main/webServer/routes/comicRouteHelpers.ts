import * as path from 'node:path';
import type { QueryOptions } from '../../../shared/types';
import { parseQueryOptions } from '../middleware';

/**
 * @file comicRouteHelpers.ts
 * Comic HTTP Route Helpers
 *
 * 
 * Architecture overview for Junior Devs:
 * The comic API routes deal with messy HTTP input (query strings, file
 * extensions, free-form request bodies). This module holds the pure parsing and
 * mapping logic so the route handlers themselves stay thin and the tricky bits
 * (MIME lookup tables, input validation) can be unit tested without a server.
 *
 * Note the validation pattern in `normalizeMetadataGenre`: instead of throwing,
 * it returns a tagged result (`{ ok: true, ... }` or `{ ok: false, error }`) so
 * the caller can decide the HTTP status.
 */

/** Query options accepted by comic list routes, plus read-status/favorites filters. */
export type ComicRouteOptions = QueryOptions & {
  readStatus?: 'unread' | 'in-progress' | 'completed';
  favorites?: boolean;
};

/** External metadata providers we can fetch comic info from. */
export type MetadataSource = 'comicvine' | 'anilist' | 'mangadex';

/** Maps page image extensions to their HTTP Content-Type. */
const PAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  jxl: 'image/png',
};

/** Maps book file extensions to their HTTP Content-Type. */
const BOOK_MIME: Record<string, string> = {
  '.epub': 'application/epub+zip',
  '.pdf': 'application/pdf',
  '.mobi': 'application/x-mobipocket-ebook',
};

/** Allow-list of valid metadata source identifiers. */
const METADATA_SOURCES = new Set<MetadataSource>(['comicvine', 'anilist', 'mangadex']);

/**
 * Parse and normalise comic-list query parameters from a request.
 *  Applies a default page limit and only accepts known read-status and
 *          favorites values, ignoring anything unrecognised.
 * @param query The raw request query object.
 * @returns Normalised comic route options.
 */
export function parseComicRouteOptions(query: Record<string, string>): ComicRouteOptions {
  const opts = parseQueryOptions(query) as ComicRouteOptions;
  if (!opts.limit) opts.limit = 50;
  if (query.readStatus === 'unread' || query.readStatus === 'in-progress' || query.readStatus === 'completed') {
    opts.readStatus = query.readStatus;
  }
  if (query.favorites === 'true') opts.favorites = true;
  return opts;
}

/**
 * Resolve the Content-Type for a comic page image by filename.
 * @param filename The page filename (may be undefined).
 * @returns The matching MIME type, defaulting to `image/png`.
 */
export function pageMimeForFilename(filename: string | undefined): string {
  const ext = filename?.split('.').pop()?.toLowerCase() ?? '';
  return PAGE_MIME[ext] ?? 'image/png';
}

/**
 * Extract a page image's lower-cased extension.
 * @param filename The page filename (may be undefined).
 * @returns The extension without the dot, or an empty string.
 */
export function pageExtensionForFilename(filename: string | undefined): string {
  return filename?.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * Resolve the Content-Type for a book file by path.
 * @param filePath Path whose extension determines the type.
 * @returns The matching MIME type, defaulting to `application/octet-stream`.
 */
export function bookMimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return BOOK_MIME[ext] ?? 'application/octet-stream';
}

/**
 * Parse a comma-separated list of metadata sources, keeping only valid ones.
 * @param raw The raw comma-separated string from the request.
 * @returns An array of recognised metadata sources (unknown entries dropped).
 */
export function parseMetadataSources(raw: string): MetadataSource[] {
  return raw
    .split(',')
    .map((source) => source.trim())
    .filter((source): source is MetadataSource => METADATA_SOURCES.has(source as MetadataSource));
}

/**
 * Parse an optional width query parameter into a positive integer.
 * @param rawWidth The raw query string value, or `undefined` if absent.
 * @returns A positive integer width, or `null` if missing or not a valid positive number.
 */
export function parsePositiveWidthParam(rawWidth: string | undefined): number | null {
  if (!rawWidth) return null;
  const width = parseInt(rawWidth, 10);
  return Number.isFinite(width) && width > 0 ? width : null;
}

/**
 * Validate and normalise a `genre` field from a metadata update body.
 *  Accepts a string, a string array (stored as JSON), `null`, or
 *          `undefined` (meaning "leave unchanged"). Returns a tagged result so
 *          the caller can turn validation failures into a 400 response.
 * @param genre The raw genre value from the request body.
 * @returns `{ ok: true, value }` on success, or `{ ok: false, error }` on invalid input.
 */
export function normalizeMetadataGenre(
  genre: unknown,
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (genre === undefined) return { ok: true, value: undefined };
  if (genre === null) return { ok: true, value: null };
  if (Array.isArray(genre)) {
    if (!genre.every((entry) => typeof entry === 'string')) {
      return { ok: false, error: '"genre" array must contain strings only' };
    }
    return { ok: true, value: JSON.stringify(genre) };
  }
  if (typeof genre === 'string') return { ok: true, value: genre };
  return { ok: false, error: '"genre" must be string, array, or null' };
}

/**
 * Parse a single-range HTTP `Range` header for byte serving.
 *
 * Supports the common forms `bytes=start-end`, `bytes=start-` (to EOF), and
 * `bytes=-suffix` (last N bytes). Multi-range requests are intentionally not
 * supported — we fall back to serving the whole file for those.
 *
 * @param header The raw `Range` request header, or `undefined` if absent.
 * @param size The total size of the file in bytes.
 * @returns `null` when no usable single range is requested (serve whole file),
 *          `'invalid'` when the range is unsatisfiable (respond 416), or the
 *          resolved inclusive `{ start, end }` byte offsets.
 */
export function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return 'invalid';

  let start: number;
  let end: number;
  if (rawStart === '') {
    // Suffix range: last `rawEnd` bytes.
    const suffix = parseInt(rawEnd, 10);
    if (suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === '' ? size - 1 : parseInt(rawEnd, 10);
  }

  if (Number.isNaN(start) || Number.isNaN(end)) return 'invalid';
  if (start > end || start >= size) return 'invalid';
  if (end >= size) end = size - 1;
  return { start, end };
}
