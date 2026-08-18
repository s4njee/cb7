/**
 * @module
 * Embedded Metadata Parsing (ComicInfo.xml / comicinfo.json)
 *
 * Architecture overview for Junior Devs:
 * Comic archives (.cbz/.cbr) usually ship with an embedded metadata file that
 * describes the book far better than the filename can: "Saga 27.cbz" on disk
 * becomes `{ title: "Saga", chapterNumber: 27, author: "Brian K. Vaughan",
 * genre: "Fantasy", ... }`. This module is the *parse layer* for that metadata:
 * it reads the file out of an archive and turns it into plain structured data.
 * A separate module (the ingest service) decides how to store it.
 *
 * Two conventions exist in the wild:
 *   - `ComicInfo.xml`  — the ComicRack schema (a flat list of `<Title>`, `<Series>`,
 *     `<Writer>`, ... tags). This is the one most CBZ/CBR files carry.
 *   - `comicinfo.json` — a loose community convention with the same fields as keys.
 * Both are parsed by this module; `readComicInfoFromArchive` tries XML first,
 * then JSON, and returns whichever yields data.
 *
 * The contract with the rest of the pipeline is deliberately simple:
 *   - `EmbeddedMetadata` fields are PRESENT ONLY when the file actually provided
 *     a non-empty value. An absent field means "unknown". This is what makes
 *     "file beats filename" a one-liner in `resolveIngestMetadata`:
 *     `embedded.x !== undefined`.
 *   - `resolveIngestMetadata` merges filename-derived info with embedded info.
 *     For the title it prefers the embedded value and falls back to the filename.
 *     For series/volume/chapter it prefers embedded and falls back to the
 *     filename's `SeriesInfo`. Author/artist/genre/year/summary/language/
 *     publisher exist only in embedded data, so they're `null` when absent.
 *
 * The parsers are deliberately hand-rolled (a regex per tag plus a tiny entity
 * decoder) rather than pulling in an XML library: ComicInfo.xml has a small,
 * fixed set of flat tags, and `JSON.parse` already handles the JSON variant.
 */

import type { ArchiveHandle } from '../shared/types';
import { readArchiveEntry } from './archiveLoader';
import type { SeriesInfo } from './seriesParser';

/** Parsed embedded metadata. A field is PRESENT ONLY when the file provided a
 *  non-empty value; absent means "unknown" — that is what makes "file beats
 *  filename" a simple `embedded.x !== undefined` check. */
export interface EmbeddedMetadata {
  title?: string;
  seriesName?: string | null;
  volumeNumber?: number | null;
  chapterNumber?: number | null;
  author?: string | null;
  artist?: string | null;
  genre?: string | null;
  year?: number | null;
  summary?: string | null;
  language?: string | null;
  publisher?: string | null;
  tags?: string[];
}

/** Fully-resolved fields for the ingest insert: file beats filename. */
export interface ResolvedIngestMetadata {
  title: string;
  seriesName: string | null;
  volumeNumber: number | null;
  chapterNumber: number | null;
  author: string | null;
  artist: string | null;
  genre: string | null;
  year: number | null;
  summary: string | null;
  language: string | null;
  publisher: string | null;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Shared text helpers
// ---------------------------------------------------------------------------

/**
 * Decode the five basic XML entities. `&amp;` is decoded LAST so a literal
 * `&amp;lt;` becomes `&lt;` rather than being double-decoded into `<`.
 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Trim text and collapse runs of whitespace to single spaces. */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Set a parsed field on an `EmbeddedMetadata`. A union-keyed write
 * (`meta[field] = value` with `field: keyof EmbeddedMetadata`) doesn't
 * typecheck because each field has a different type, so we widen to a
 * string-keyed record. The field→value pairing is curated by the caller's
 * field tables, which already narrow each value to its field's type.
 */
function assignField(meta: EmbeddedMetadata, field: keyof EmbeddedMetadata, value: unknown): void {
  (meta as Record<string, unknown>)[field] = value;
}

/**
 * Read a text value from a JSON field (string or number). Returns `undefined`
 * when the value is empty or not a usable string/number.
 */
function readJsonText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = normalizeText(decodeXmlEntities(value));
    return text.length > 0 ? text : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/**
 * Read a finite number from a JSON field (number or numeric string). Returns
 * `undefined` when the value is empty or not parseable as a number.
 */
function readJsonNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// ComicInfo.xml (ComicRack convention)
// ---------------------------------------------------------------------------

/** Text-producing ComicInfo.xml tags, mapped to their `EmbeddedMetadata` field. */
const XML_TEXT_FIELDS: ReadonlyArray<[tag: string, field: keyof EmbeddedMetadata]> = [
  ['Title', 'title'],
  ['Series', 'seriesName'],
  ['Writer', 'author'],
  ['Penciller', 'artist'],
  ['Genre', 'genre'],
  ['Summary', 'summary'],
  ['Language', 'language'],
  ['Publisher', 'publisher'],
];

/** Number-producing ComicInfo.xml tags, mapped to their `EmbeddedMetadata` field. */
const XML_NUMBER_FIELDS: ReadonlyArray<[tag: string, field: keyof EmbeddedMetadata]> = [
  ['Volume', 'volumeNumber'],
  ['Number', 'chapterNumber'],
  ['Year', 'year'],
];

/**
 * Extract the text of the first `<tag>…</tag>` element (case-insensitive,
 * tolerant of attributes on the opening tag). Returns `undefined` when the tag
 * is missing or its text is empty after trimming/collapsing whitespace.
 */
function extractTagText(xml: string, tag: string): string | undefined {
  // `<tag>` or `<tag attr="…">`, but never `<tagOther>` — the closing `</tag>`
  // already guarantees we landed on the exact tag.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(re);
  if (!match) return undefined;
  const text = normalizeText(decodeXmlEntities(match[1]));
  return text.length > 0 ? text : undefined;
}

/** Like `extractTagText` but coerces the value to a finite number. */
function extractNumericTag(xml: string, tag: string): number | undefined {
  const text = extractTagText(xml, tag);
  if (text === undefined) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a ComicRack `ComicInfo.xml` document into `EmbeddedMetadata`.
 * Tags are matched case-insensitively. `PageCount` is deliberately ignored:
 * the archive's real entry count is the authoritative page count.
 * `Genre` is kept as a single string (never split on commas).
 */
export function parseComicInfoXml(xml: string): EmbeddedMetadata {
  const meta: EmbeddedMetadata = {};
  for (const [tag, field] of XML_TEXT_FIELDS) {
    const value = extractTagText(xml, tag);
    if (value !== undefined) assignField(meta, field, value);
  }
  for (const [tag, field] of XML_NUMBER_FIELDS) {
    const value = extractNumericTag(xml, tag);
    if (value !== undefined) assignField(meta, field, value);
  }
  return meta;
}

// ---------------------------------------------------------------------------
// comicinfo.json (loose community convention)
// ---------------------------------------------------------------------------

/** Text-producing comicinfo.json keys (lowercase) and their field mapping. */
const JSON_TEXT_FIELDS: ReadonlyArray<[key: string, field: keyof EmbeddedMetadata]> = [
  ['title', 'title'],
  ['series', 'seriesName'],
  ['writer', 'author'],
  ['penciller', 'artist'],
  ['genre', 'genre'],
  ['summary', 'summary'],
  ['language', 'language'],
  ['publisher', 'publisher'],
];

/** Number-producing comicinfo.json keys (lowercase) and their field mapping. */
const JSON_NUMBER_FIELDS: ReadonlyArray<[key: string, field: keyof EmbeddedMetadata]> = [
  ['volume', 'volumeNumber'],
  ['number', 'chapterNumber'],
  ['year', 'year'],
];

/**
 * Parse a `comicinfo.json` document into `EmbeddedMetadata`. Keys are accepted
 * case-insensitively (matching the loose convention in the wild) and values may
 * be numbers or strings. Fields whose value is empty are omitted.
 */
export function parseComicInfoJson(json: string): EmbeddedMetadata {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};

  const byLowerKey = new Map<string, unknown>();
  for (const [key, value] of Object.entries(data)) {
    byLowerKey.set(key.toLowerCase(), value);
  }

  const meta: EmbeddedMetadata = {};
  for (const [key, field] of JSON_TEXT_FIELDS) {
    const value = readJsonText(byLowerKey.get(key));
    if (value !== undefined) assignField(meta, field, value);
  }
  for (const [key, field] of JSON_NUMBER_FIELDS) {
    const value = readJsonNumber(byLowerKey.get(key));
    if (value !== undefined) assignField(meta, field, value);
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Archive reading
// ---------------------------------------------------------------------------

/**
 * Read the embedded metadata out of an open archive (CBZ or CBR).
 * Looks for `ComicInfo.xml` first, then `comicinfo.json`, both matched by
 * (case-insensitive) basename via `readArchiveEntry`. If the first file found
 * parses to zero fields we fall through to the next rather than giving up.
 *
 * @param handle An already-opened archive handle.
 * @returns Parsed metadata, or `null` when the archive has neither file (or
 *          both parse to nothing).
 */
export async function readComicInfoFromArchive(
  handle: ArchiveHandle,
): Promise<EmbeddedMetadata | null> {
  const xml = await readArchiveEntry(handle, 'ComicInfo.xml');
  if (xml) {
    const meta = parseComicInfoXml(xml.toString('utf8'));
    if (Object.keys(meta).length > 0) return meta;
  }

  const json = await readArchiveEntry(handle, 'comicinfo.json');
  if (json) {
    const meta = parseComicInfoJson(json.toString('utf8'));
    if (Object.keys(meta).length > 0) return meta;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Merge: file beats filename
// ---------------------------------------------------------------------------

/**
 * Merge filename-derived info with embedded metadata into the fully-resolved
 * fields used by the ingest insert.
 *
 * Precedence ("file beats filename"):
 *   - `title`: embedded title when present, else the filename-derived title.
 *   - `seriesName` / `volumeNumber` / `chapterNumber`: embedded value when
 *     present, else the filename `SeriesInfo` value.
 *   - `author` / `artist` / `genre` / `year` / `summary` / `language` /
 *     `publisher`: only ever come from embedded data — `null` when absent.
 *   - `tags`: embedded tags, `[]` when absent.
 */
export function resolveIngestMetadata(
  titleFromFilename: string,
  seriesInfo: SeriesInfo,
  embedded: EmbeddedMetadata | null,
): ResolvedIngestMetadata {
  return {
    title: embedded?.title ?? titleFromFilename,
    seriesName: embedded?.seriesName !== undefined ? embedded.seriesName : seriesInfo.seriesName,
    volumeNumber: embedded?.volumeNumber !== undefined ? embedded.volumeNumber : seriesInfo.volumeNumber,
    chapterNumber: embedded?.chapterNumber !== undefined ? embedded.chapterNumber : seriesInfo.chapterNumber,
    author: embedded?.author ?? null,
    artist: embedded?.artist ?? null,
    genre: embedded?.genre ?? null,
    year: embedded?.year ?? null,
    summary: embedded?.summary ?? null,
    language: embedded?.language ?? null,
    publisher: embedded?.publisher ?? null,
    tags: embedded?.tags ?? [],
  };
}
