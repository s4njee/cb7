/**
 * @module
 * Drag-and-Drop File Type Validation
 *
 * Architecture overview for Junior Devs:
 * When a user drags files onto the app we need to decide, before doing any real
 * work, whether each file is something we can open. These helpers answer that
 * with a cheap extension check. They wrap `mediaTypes.ts` so the accepted
 * formats stay defined in exactly one place.
 */

import { COMIC_EXTENSIONS, BOOK_EXTENSIONS, isSupportedFile as _isSupportedFile } from './mediaTypes';

/**
 * Is this a comic archive (.cbz / .cbr)?
 * @param filename The dropped file's name.
 * @returns `true` for recognized comic archive extensions (case-insensitive).
 */
export function isComicArchive(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? COMIC_EXTENSIONS.has(ext) : false;
}

/**
 * Is this a book file (.pdf / .epub / .mobi)?
 * @param filename The dropped file's name.
 * @returns `true` for recognized book extensions (case-insensitive).
 */
export function isBookFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? BOOK_EXTENSIONS.has(ext) : false;
}

/**
 * Is this any supported media file (comic or book)?
 * @param filename The dropped file's name.
 * @returns `true` if the file is either a comic archive or a book file.
 */
export function isSupportedFile(filename: string): boolean {
  return _isSupportedFile(filename);
}
