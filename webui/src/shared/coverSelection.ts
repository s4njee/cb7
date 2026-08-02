/**
 * @module
 * Cover Image Selection for Comic Archives
 *
 * Architecture overview for Junior Devs:
 * A comic archive (CBZ/CBR) is just a zip of image files. To show a thumbnail we
 * need to pick one image to act as the cover. The rule is simple:
 *   1. If a file is literally named "cover" (e.g. cover.jpg), use that.
 *   2. Otherwise fall back to the first image once the list is naturally sorted.
 *
 * The caller is responsible for sorting the entries first (see `naturalSort.ts`);
 * this module only applies the selection rule.
 */

export interface ImageEntry {
  filename: string;
  index: number;
}

/**
 * Pick the cover image from a list of archive image entries.
 *
 * @param entries Image entries, expected to already be in natural sort order.
 * @returns The "cover"-named entry if present, otherwise the first entry, or
 *          `null` when the list is empty.
 */
export function selectCoverImage(entries: ImageEntry[]): ImageEntry | null {
  if (entries.length === 0) {
    return null;
  }

  // Look for an entry with basename "cover" (case-insensitive)
  const coverEntry = entries.find((entry) => {
    const basename = entry.filename.split('/').pop()?.split('.')[0]?.toLowerCase();
    return basename === 'cover';
  });

  return coverEntry ?? entries[0];
}
