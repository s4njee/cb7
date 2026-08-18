import { isImageFile } from '../shared/imageFilter';
import { naturalCompare } from '../shared/naturalSort';

/**
 * @file archiveEntryHelpers.ts
 * Archive Entry Filtering & Ordering Helpers
 *
 * 
 * Architecture overview for Junior Devs:
 * A comic archive (CBZ/CBR/7z) is really just a zip-like container full of
 * files. Not all of those files are pages — there can be folders, metadata
 * files, thumbnails, etc. This module's job is to turn a raw list of archive
 * entry names into a clean, ordered list of *image pages* the reader can show.
 *
 * Two reader-facing concerns live here:
 *  - Filtering: keep only image files, drop directories and junk.
 *  - Ordering: sort with `naturalCompare` so "page2" comes before "page10"
 *    (a plain string sort would put "page10" first).
 *
 * `SevenZipEntryLike` exists because the 7-zip library reports entries in its
 * own shape; we normalise those into the same `ArchiveEntry` list everything
 * else uses.
 */

/** A single image page extracted from an archive, paired with its 0-based reading order. */
export interface ArchiveEntry {
  filename: string;
  index: number;
}

/** Minimal shape of a 7-zip entry record (the fields we actually read). */
export type SevenZipEntryLike = {
  file?: string;
  techInfo?: Map<string, string>;
};

/**
 * Extract the final path segment (the file's own name) from an entry path.
 * @param filename Full entry path, using either `/` or `\` separators.
 * @returns The last non-empty segment, or the original string if none was found.
 */
export function archiveBasename(filename: string): string {
  return filename.split(/[\\/]+/).filter(Boolean).at(-1) ?? filename;
}

/**
 * Get the file extension (text after the final dot).
 * @param filename The entry filename.
 * @returns The extension without the dot, or an empty string if there is none.
 */
export function archiveExtension(filename: string): string {
  return filename.split('.').pop() ?? '';
}

/**
 * Turn a raw list of archive filenames into ordered image pages.
 *  Keeps only image files, sorts them in natural (human) order, then
 *          assigns each a sequential `index` for use as the page number.
 * @param filenames All entry names found in the archive.
 * @returns Image entries in reading order.
 */
export function archiveImageEntries(filenames: string[]): ArchiveEntry[] {
  return filenames
    .filter(isImageFile)
    .sort((a, b) => naturalCompare(a, b))
    .map((filename, index) => ({ filename, index }));
}

/**
 * Decide whether a 7-zip record represents a directory rather than a file.
 *  7-zip flags directories via its `techInfo` map — either a `Folder`
 *          marker of `+` or a `D` in the `Attributes` string. We skip these so
 *          folders never get mistaken for pages.
 * @param record The 7-zip entry to inspect.
 * @returns `true` if the record is a directory.
 */
export function isSevenZipDirectory(record: SevenZipEntryLike): boolean {
  const techInfo = record.techInfo;
  if (!techInfo) return false;
  return techInfo.get('Folder') === '+' || (techInfo.get('Attributes') ?? '').includes('D');
}

/**
 * Convert 7-zip entry records into ordered image pages.
 *  Drops directories and entries with no filename, then delegates to
 *          `archiveImageEntries` so the filtering/ordering rules stay identical
 *          to other archive formats.
 * @param records The raw 7-zip entry records.
 * @returns Image entries in reading order.
 */
export function sevenZipImageEntries(records: SevenZipEntryLike[]): ArchiveEntry[] {
  return archiveImageEntries(
    records
      .filter((record) => record.file && !isSevenZipDirectory(record))
      .map((record) => record.file!),
  );
}
