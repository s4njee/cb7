/**
 * @module
 * Image File Extension Filter
 *
 * Architecture overview for Junior Devs:
 * When we open a comic archive it can contain non-image junk (ReadMe.txt,
 * Thumbs.db, metadata files). Before treating an entry as a page we check its
 * extension against this allowlist. Keeping the list in one place means the
 * reader, the cover picker, and the ingest scanner all agree on what counts as
 * a page.
 */

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'jxl',
  'avif',
]);

/**
 * Check whether a filename looks like a supported image.
 *
 * Case-insensitive; only the part after the last dot is inspected.
 *
 * @param filename The entry name to test (may include a path).
 * @returns `true` if the extension is a recognized image format.
 */
export function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
}
