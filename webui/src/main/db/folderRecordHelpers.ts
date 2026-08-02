/**
 * @module
 * Folder Record Derivation Helpers
 *
 * Architecture overview for Junior Devs:
 * When we build or update a folder row, a couple of fields are *derived* from
 * the folder's contents rather than stored directly: what kind of media it holds
 * (comic / book / mixed / empty) and which comic to use as its cover. These pure
 * functions compute those values so the DB layer stays simple and the rules can
 * be unit tested in isolation.
 */

/** Classification of a folder by the kind of media it contains. */
export type FolderMediaType = 'comic' | 'book' | 'mixed' | 'empty';

/**
 * Classify a folder by the media types it contains.
 * A folder with no comics is `empty`; one holding both comics and books
 *          is `mixed`; otherwise it is `book` or `comic` based on which items it has.
 * @param comicCount Total item count in the folder (0 means empty).
 * @param comicItems Number of comic items, or `null` if unknown.
 * @param bookItems Number of book items, or `null` if unknown.
 * @returns The derived folder media type.
 */
export function resolveFolderMediaType(
  comicCount: number,
  comicItems: number | null,
  bookItems: number | null,
): FolderMediaType {
  const nComic = comicItems ?? 0;
  const nBook = bookItems ?? 0;
  if (comicCount === 0) return 'empty';
  if (nComic > 0 && nBook > 0) return 'mixed';
  if (nBook > 0) return 'book';
  return 'comic';
}

/**
 * Pick the default cover comic for a folder.
 * @param comicIds The folder's comic ids, in order.
 * @returns The first comic id, or `null` if the folder has none.
 */
export function initialFolderCoverId(comicIds: number[]): number | null {
  return comicIds.length > 0 ? comicIds[0] : null;
}

/**
 * Decide whether a folder needs its cover set for the first time.
 * Only true when no cover is currently assigned and at least one comic
 *          is available to use.
 * @param currentCoverId The folder's existing cover id, if any.
 * @param comicIds The folder's comic ids.
 * @returns `true` if an initial cover should be assigned.
 */
export function shouldSetInitialFolderCover(currentCoverId: number | null | undefined, comicIds: number[]): boolean {
  return currentCoverId == null && comicIds.length > 0;
}

/**
 * Return the first cover id to assign, or `null` when no update is needed.
 * This combines the two cover rules used by folder membership writes:
 *          only assign a cover when the folder does not already have one, and
 *          use the first newly-added comic id.
 */
export function initialFolderCoverUpdateId(
  currentCoverId: number | null | undefined,
  comicIds: number[],
): number | null {
  return shouldSetInitialFolderCover(currentCoverId, comicIds) ? comicIds[0] : null;
}
