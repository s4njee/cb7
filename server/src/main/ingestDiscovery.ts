import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { isImageFile } from '../shared/imageFilter';
import { BOOK_EXTENSIONS, COMIC_EXTENSIONS } from '../shared/mediaTypes';

/**
 * @module
 * Ingest Discovery Helpers
 *
 * Architecture overview for Junior Devs:
 * These helpers do the filesystem walk for library scans. They do not parse
 * archives, read covers, or write to the database; they only collect file paths
 * whose extensions match the requested media type. Keeping discovery separate
 * from `IngestService` makes the ingest flow easier to follow and lets us test
 * recursive scan behavior with tiny temporary folders.
 *
 * Folder-comics (P1-6):
 * A plain directory of image files (JPG/PNG/WEBP/AVIF) is ONE comic. A directory
 * is emitted as a folder-comic when it *directly* contains at least one image
 * file AND *directly* contains no file with any known media extension
 * (COMIC_EXTENSIONS ∪ BOOK_EXTENSIONS). A directory holding a .cbz/.cbr/.cb7/
 * .epub/.pdf is NOT a comic — its files scan normally, so the directory must not
 * be emitted or those files would be double-counted. Image-only subdirectories
 * each become their own comic; loose image files are never ingested
 * individually. Only comic scans emit folder-comics (a book-only scan never
 * creates comics, and a combined scan never double-emits).
 */

/** Every extension CB8 treats as a real media file, dot-prefixed. A directory
 *  directly containing any of these is a plain folder, never a folder-comic. */
const ALL_MEDIA_EXTENSIONS = new Set(
  [...COMIC_EXTENSIONS, ...BOOK_EXTENSIONS].map((e) => `.${e}`),
);

async function collectFilesInDirectory(
  dirPath: string,
  files: string[],
  extensions: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  // Folder-comics only apply during a comic scan (see module docstring). We
  // skip the whole rule when this is a book scan to avoid creating comics and
  // to avoid double-emission if the pipeline scans both media types.
  const isComicScan = [...COMIC_EXTENSIONS].some((e) => extensions.has(`.${e}`));
  let hasDirectImage = false;
  let hasDirectMedia = false;

  const dir = await fsp.opendir(dirPath);
  for await (const entry of dir) {
    if (signal?.aborted) break;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await discoverFiles(fullPath, files, extensions, signal);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.has(ext)) files.push(fullPath);
      if (isComicScan) {
        // Track only direct children: a sub-folder's images are handled when we
        // recurse into it, not here.
        if (isImageFile(entry.name)) hasDirectImage = true;
        if (ALL_MEDIA_EXTENSIONS.has(ext)) hasDirectMedia = true;
      }
    }
  }

  // A directory of loose images is itself one comic. The `!hasDirectMedia`
  // guard is the P1-6 rule: any direct .cbz/.cbr/.cb7/.epub/.pdf means the
  // directory is a plain folder whose files scan normally. (The opendir handle
  // is consumed by the for-await loop above, so this emit must come after it.)
  if (isComicScan && hasDirectImage && !hasDirectMedia) {
    files.push(dirPath);
  }
}

export async function discoverFiles(
  dirPath: string,
  files: string[],
  extensions: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  try {
    await collectFilesInDirectory(dirPath, files, extensions, signal);
  } catch (err) {
    console.error(`Failed to open directory ${dirPath}:`, err);
  }
}

async function collectFilesChangedSinceInDirectory(
  dirPath: string,
  files: string[],
  extensions: Set<string>,
  since: number,
  signal?: AbortSignal,
): Promise<void> {
  const dirStat = await fsp.stat(dirPath);
  const dirChanged = dirStat.mtimeMs > since;
  const isComicScan = [...COMIC_EXTENSIONS].some((e) => extensions.has(`.${e}`));
  let hasDirectImage = false;
  let hasDirectMedia = false;

  const dir = await fsp.opendir(dirPath);
  for await (const entry of dir) {
    if (signal?.aborted) break;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await discoverFilesChangedSince(fullPath, files, extensions, since, signal);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (dirChanged && extensions.has(ext)) files.push(fullPath);
      if (isComicScan) {
        if (isImageFile(entry.name)) hasDirectImage = true;
        if (ALL_MEDIA_EXTENSIONS.has(ext)) hasDirectMedia = true;
      }
    }
  }

  // Same folder-comic rule as `collectFilesInDirectory`, additionally gated on
  // the directory's own mtime (mirroring how per-file emission is gated).
  if (isComicScan && dirChanged && hasDirectImage && !hasDirectMedia) {
    files.push(dirPath);
  }
}

export async function discoverFilesChangedSince(
  dirPath: string,
  files: string[],
  extensions: Set<string>,
  since: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  try {
    await collectFilesChangedSinceInDirectory(dirPath, files, extensions, since, signal);
  } catch (err) {
    console.error(`Failed to open directory ${dirPath}:`, err);
  }
}
