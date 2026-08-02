import * as fs from 'node:fs';
import * as path from 'node:path';
import { BOOK_EXTS, COMIC_EXTS } from '../ingest';

/**
 * @module
 * Upload & Directory-Browse Route Helpers
 *
 * Architecture overview for Junior Devs:
 * Uploads are a security-sensitive area: the client sends a filename and a
 * relative path, and a naive server could be tricked into writing outside the
 * upload directory (path traversal via `..`, absolute paths, or Windows drive
 * letters). This module centralises the defensive parsing and validation so the
 * route handler can trust the values it receives.
 *
 * The validation functions follow a tagged-result style (`{ ok: true, ... }` /
 * `{ ok: false, status, error }`) so each failure carries the HTTP status the
 * handler should return. Also here: directory autocomplete for the "add path"
 * UI, and throttling logic for streaming ingest progress events.
 */

/** Result of parsing the upload headers: parsed names, or an HTTP error. */
export type UploadHeaderParseResult =
  | { ok: true; filename: string; relPath: string }
  | { ok: false; status: number; error: string };

/** A single directory-autocomplete suggestion. */
export type DirectorySuggestion = {
  name: string;
  path: string;
  isDir: boolean;
};

export type AddPathFolderTarget =
  | { kind: 'none' }
  | { kind: 'existing'; id: number }
  | { kind: 'create'; name: string };

/**
 * Decode the custom upload headers (filename and relative path).
 * Both headers are percent-encoded UTF-8; the relative path falls back
 *          to the filename when absent. Decoding failures yield a 400 result.
 * @param rawName The raw `X-CB8-Filename` header value.
 * @param rawRel The raw relative-path header value.
 * @returns Parsed filename/relPath, or a tagged error with an HTTP status.
 */
export function parseUploadHeaders(rawName: unknown, rawRel: unknown): UploadHeaderParseResult {
  if (typeof rawName !== 'string' || !rawName) {
    return { ok: false, status: 400, error: 'Missing X-CB8-Filename header' };
  }

  try {
    const filename = decodeURIComponent(rawName);
    const relPath = typeof rawRel === 'string' && rawRel ? decodeURIComponent(rawRel) : filename;
    return { ok: true, filename, relPath };
  } catch {
    return { ok: false, status: 400, error: 'Headers are not valid percent-encoded UTF-8' };
  }
}

/**
 * Detect path shapes that could escape the upload directory.
 * Flags null bytes, leading slashes (absolute POSIX paths), and Windows
 *          drive-letter prefixes — all of which indicate a non-relative path.
 * @param value The string to inspect.
 * @returns `true` if the value has an unsafe shape.
 */
function hasUnsafePathShape(value: string): boolean {
  return value.includes('\0') || value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(value);
}

/**
 * Validate an upload's filename and relative path, and split the path.
 * Rejects unsafe path shapes, filenames containing directory parts,
 *          empty or traversing relative paths (`.` / `..`), and unsupported file
 *          extensions. On success returns the cleaned relative path segments.
 * @param filename The decoded upload filename.
 * @param relPath The decoded relative destination path.
 * @returns `{ ok: true, relParts }` on success, or a tagged error with HTTP status.
 */
export function validateUploadPathParts(
  filename: string,
  relPath: string,
): { ok: true; relParts: string[] } | { ok: false; status: number; error: string } {
  if (hasUnsafePathShape(filename) || hasUnsafePathShape(relPath) || path.basename(filename) !== filename) {
    return { ok: false, status: 400, error: 'Invalid filename' };
  }

  const relParts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (relParts.length === 0 || relParts.some((part) => part === '..' || part === '.')) {
    return { ok: false, status: 400, error: 'Invalid relative path' };
  }

  const ext = path.extname(filename).toLowerCase();
  if (!COMIC_EXTS.has(ext) && !BOOK_EXTS.has(ext)) {
    return { ok: false, status: 415, error: 'Unsupported file type' };
  }

  return { ok: true, relParts };
}

/**
 * Resolve the final upload destination, guarding against traversal.
 * Resolves the destination under the base directory and confirms it
 *          really stays inside it (defence-in-depth on top of part validation).
 * @param baseDir The upload root directory.
 * @param relParts The validated relative path segments.
 * @returns The absolute destination path, or `null` if it would escape the base.
 */
export function resolveUploadDestination(baseDir: string, relParts: string[]): string | null {
  const resolvedBase = path.resolve(baseDir);
  const destPath = path.resolve(resolvedBase, ...relParts);
  return destPath.startsWith(resolvedBase + path.sep) ? destPath : null;
}

/**
 * Split a browse path into a directory to list and a name prefix to match.
 * If the path is itself a directory, lists its contents with no prefix;
 *          otherwise treats the last segment as a typed prefix for autocomplete.
 * @param rawPath The raw path the user has typed.
 * @returns The directory to scan and the prefix to filter by.
 */
export function resolveDirectoryLookup(rawPath: string): { dir: string; prefix: string } {
  try {
    const stat = fs.statSync(rawPath);
    if (stat.isDirectory()) return { dir: rawPath, prefix: '' };
  } catch {
    // Fall through to treating the last segment as a prefix.
  }
  return { dir: path.dirname(rawPath), prefix: path.basename(rawPath) };
}

/**
 * Build directory-autocomplete suggestions for the "add path" UI.
 * Hides dotfiles, matches the prefix case-insensitively, keeps only
 *          sub-directories and supported media files, sorts directories first,
 *          and caps the result at 50 entries.
 * @param dir The directory being listed.
 * @param prefix The name prefix to filter by.
 * @param entries The directory entries read from disk.
 * @returns Up to 50 sorted suggestions.
 */
export function directorySuggestions(
  dir: string,
  prefix: string,
  entries: fs.Dirent[],
): DirectorySuggestion[] {
  const lowerPrefix = prefix.toLowerCase();
  return entries
    .filter((entry) => !entry.name.startsWith('.') && entry.name.toLowerCase().startsWith(lowerPrefix))
    .map((entry) => {
      const isDir = entry.isDirectory();
      const full = path.join(dir, entry.name);
      return { name: entry.name, path: isDir ? full + path.sep : full, isDir };
    })
    .filter((entry) => {
      if (entry.isDir) return true;
      const ext = path.extname(entry.name).toLowerCase();
      return COMIC_EXTS.has(ext) || BOOK_EXTS.has(ext);
    })
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    .slice(0, 50);
}

/**
 * Parse and clamp the ingest-error limit query parameter.
 * @param rawLimit The raw limit string, if any.
 * @returns A limit between 1 and 500, defaulting to 50 when missing/invalid.
 */
export function parseIngestErrorLimit(rawLimit: string | undefined): number {
  const limitParam = rawLimit ? parseInt(rawLimit, 10) : NaN;
  return Number.isFinite(limitParam) ? Math.max(1, Math.min(500, limitParam)) : 50;
}

export function resolveAddPathFolderTarget(
  rawFolderName: unknown,
  existingFolders: Array<{ id: number; name: string }>
): AddPathFolderTarget {
  const folderName = typeof rawFolderName === 'string' ? rawFolderName.trim() : '';
  if (!folderName) return { kind: 'none' };

  const existing = existingFolders.find(
    (folder) => folder.name.toLowerCase() === folderName.toLowerCase(),
  );
  return existing ? { kind: 'existing', id: existing.id } : { kind: 'create', name: folderName };
}
