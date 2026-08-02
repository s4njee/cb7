import sharp from 'sharp';

/**
 * @module
 * Generate Small Cover Thumbnails for the Library Grid
 *
 * Architecture overview for Junior Devs:
 * Every library item shows a small cover image. This module shrinks a full-size
 * cover into a compact JPEG that's stored directly in the database
 * (`comics.cover_thumbnail`). If the source is missing or can't be decoded, it
 * returns a baked-in placeholder image instead, so the grid never shows a broken
 * tile. `isPlaceholderThumbnail` lets callers detect that fallback (e.g. to
 * retry extraction later).
 */

const MAX_WIDTH = 240;
const MAX_HEIGHT = 360;
const JPEG_QUALITY = 82;

const PLACEHOLDER_THUMBNAIL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAPAAAAFoCAIAAADghSIYAAADbklEQVR4nO3TMQ0AMAwAsGT+Od2NIUMVMQrsnTXzAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4GmWIAAFwq2fKAAAAAElFTkSuQmCC',
  'base64'
);

/**
 * Resize a cover image into a small JPEG for the `cover_thumbnail` column.
 * @param source The full-size cover bytes, or null/undefined when none exists.
 * @returns A small JPEG buffer, or the built-in placeholder when the input is
 *          empty, malformed, or undecodable.
 */
export async function generateThumbnail(source: Buffer | null | undefined): Promise<Buffer> {
  if (!source || source.length === 0) return PLACEHOLDER_THUMBNAIL;

  try {
    const encoded = await sharp(source)
      .resize({
        width: MAX_WIDTH,
        height: MAX_HEIGHT,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return encoded.length > 0 ? encoded : PLACEHOLDER_THUMBNAIL;
  } catch {
    return PLACEHOLDER_THUMBNAIL;
  }
}

/**
 * Is this buffer the built-in placeholder thumbnail?
 * Useful for deciding whether cover extraction should be retried.
 * @param source The thumbnail bytes to test.
 * @returns `true` if the bytes match the placeholder exactly.
 */
export function isPlaceholderThumbnail(source: Buffer | null | undefined): boolean {
  return Boolean(source && source.length === PLACEHOLDER_THUMBNAIL.length && source.equals(PLACEHOLDER_THUMBNAIL));
}
