import * as path from 'node:path';
import { BOOK_EXTENSIONS, COMIC_EXTENSIONS } from '../shared/mediaTypes';

/**
 * @file ingestPathHelpers.ts
 * Ingest Path & Series-Inference Helpers
 *
 * 
 * Architecture overview for Junior Devs:
 * When the scanner walks a library folder, it needs to figure out where each
 * file sits relative to the root the user added, and guess a series name from
 * the folder structure (we treat the first sub-folder under the scan root as the
 * series). These pure path helpers do that math.
 *
 * Watch out for Windows: drive letters and `\` separators mean we can't rely on
 * `path.relative` alone for case-insensitive matching, so `relativeDirFromScanRoot`
 * special-cases `win32`.
 */

/**
 * Compute a file's directory path relative to the scan root.
 *  On Windows, paths are compared case-insensitively before slicing the
 *          root prefix; on other platforms `path.relative` is sufficient.
 * @param scanRoot The library root the user added.
 * @param filePath Absolute path to the discovered file.
 * @returns The relative directory, or a `..`-style path if the file is outside the root.
 */
export function relativeDirFromScanRoot(scanRoot: string, filePath: string): string {
  const resolvedRoot = path.resolve(scanRoot);
  const resolvedFileDir = path.resolve(path.dirname(filePath));
  if (process.platform === 'win32') {
    const rootLower = resolvedRoot.toLowerCase();
    const fileDirLower = resolvedFileDir.toLowerCase();
    if (fileDirLower.startsWith(rootLower)) {
      const relativePart = resolvedFileDir.slice(resolvedRoot.length);
      return relativePart.replace(/^[/\\]+/, '');
    }
  }
  return path.relative(resolvedRoot, resolvedFileDir);
}

/**
 * Extract the first folder segment from a relative directory.
 *  Rejects paths that point at or above the root (`.`, `..`, `../...`),
 *          which is how we avoid inferring a series from outside the library.
 * @param relativeDir A directory relative to the scan root.
 * @returns The first path segment, or `null` if there isn't a valid one.
 */
export function firstFolderFromRelativeDir(relativeDir: string): string | null {
  const normalized = relativeDir.replace(/\\/g, '/');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return null;
  }
  return normalized.split('/')[0] || null;
}

/**
 * Infer a series name for a file from its position under the scan root.
 * @param scanRoot The library root the user added.
 * @param filePath Absolute path to the discovered file.
 * @returns The inferred series (top-level sub-folder), or `null` if none applies.
 */
export function seriesNameFromScanRoot(scanRoot: string, filePath: string): string | null {
  return firstFolderFromRelativeDir(relativeDirFromScanRoot(scanRoot, filePath));
}

/**
 * Get the set of accepted file extensions for a media type, dot-prefixed.
 * @param mediaType Either `'comic'` or `'book'`.
 * @returns A set like `{ '.cbz', '.cbr', ... }` suitable for extension matching.
 */
export function dottedExtensionsForMediaType(mediaType: 'comic' | 'book'): Set<string> {
  const extensions = mediaType === 'comic' ? COMIC_EXTENSIONS : BOOK_EXTENSIONS;
  return new Set([...extensions].map((extension) => `.${extension}`));
}
