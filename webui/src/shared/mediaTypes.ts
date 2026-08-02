/**
 * @module
 * Supported File Extensions and Media-Type Detection
 *
 * Architecture overview for Junior Devs:
 * This is the one place that defines what files CB8 understands and whether each
 * one is a "comic" (a page-image archive) or a "book" (a document). Many parts of
 * the app depend on this single definition: the ingest scanner, the drop-zone
 * validator, the native file picker's filter, and the library's media-type
 * buckets. Add a new format here and everything else picks it up.
 *
 * Convention note: the extension sets store names WITHOUT a leading dot, because
 * detection is done with `filename.split('.').pop()`.
 */

// Sets WITHOUT leading dots (matches filename.split('.').pop() pattern)
export const COMIC_EXTENSIONS = new Set(['cbz', 'cbr']);
export const BOOK_EXTENSIONS = new Set(['pdf', 'epub', 'mobi']);
export const ALL_EXTENSIONS = new Set([...COMIC_EXTENSIONS, ...BOOK_EXTENSIONS]);

export const ALL_EXTENSIONS_ARRAY = Array.from(ALL_EXTENSIONS);

export const EXTENSION_LABELS: Record<string, string> = {
  cbz: 'Comic Archive (CBZ)',
  cbr: 'Comic Archive (CBR)',
  pdf: 'PDF Document',
  epub: 'EPUB Book',
  mobi: 'MOBI Book',
};

/**
 * Classify a filename as a comic, a book, or unsupported.
 * @param filename The file name to inspect (case-insensitive).
 * @returns `'comic'`, `'book'`, or `null` when the extension isn't recognized.
 */
export function detectMediaType(filename: string): 'comic' | 'book' | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (COMIC_EXTENSIONS.has(ext)) return 'comic';
  if (BOOK_EXTENSIONS.has(ext)) return 'book';
  return null;
}

/**
 * Is this file one CB8 can open at all?
 * @param filename The file name to test.
 * @returns `true` if it's a recognized comic or book.
 */
export function isSupportedFile(filename: string): boolean {
  return detectMediaType(filename) !== null;
}

/**
 * Does a list of files contain at least one supported file?
 * @param filenames The candidate file names (e.g. a drag-and-drop batch).
 * @returns `true` if any entry is supported.
 */
export function hasSupported(filenames: string[]): boolean {
  return filenames.some(isSupportedFile);
}
