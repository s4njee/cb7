/**
 * @module
 * Natural Sort Comparator for Filenames
 *
 * Architecture overview for Junior Devs:
 * A plain string sort puts "page10.jpg" before "page2.jpg" because it compares
 * character-by-character ('1' < '2'). "Natural" sorting fixes that by treating
 * runs of digits as whole numbers, so the order matches what a human expects.
 *
 * This module is used in two places: ordering the pages inside a comic archive,
 * and sorting items in the library grid. It is a pure, dependency-free module so
 * both the Node side and the browser side can import it.
 */

/**
 * Split a string into alternating non-numeric and numeric chunks.
 *
 * Example: "page10.jpg" becomes ["page", "10", ".jpg"]. The numeric
 * chunks are what let the comparator compare by value instead of by character.
 *
 * @param s The string to split.
 * @returns An array of chunks, or an empty array if the string has no content.
 */
function splitChunks(s: string): string[] {
  return s.match(/(\d+|\D+)/g) ?? [];
}

/**
 * Compare two strings using natural sort order.
 *
 * Numeric chunks are compared by integer value; non-numeric chunks are
 * compared case-insensitively. Designed to be passed straight to `Array.sort()`.
 *
 * @param a First string.
 * @param b Second string.
 * @returns Negative if `a` sorts first, positive if `b` sorts first, 0 if equal.
 */
export function naturalCompare(a: string, b: string): number {
  const chunksA = splitChunks(a);
  const chunksB = splitChunks(b);

  const len = Math.min(chunksA.length, chunksB.length);

  for (let i = 0; i < len; i++) {
    const ca = chunksA[i];
    const cb = chunksB[i];

    const isNumA = /^\d+$/.test(ca);
    const isNumB = /^\d+$/.test(cb);

    if (isNumA && isNumB) {
      // Compare as integers
      const diff = parseInt(ca, 10) - parseInt(cb, 10);
      if (diff !== 0) return diff;
      // If numerically equal but different string length (e.g. "01" vs "1"),
      // fall through to compare remaining chunks
    } else if (isNumA !== isNumB) {
      // Numeric chunks sort before non-numeric chunks
      return isNumA ? -1 : 1;
    } else {
      // Both non-numeric: case-insensitive lexicographic comparison
      const cmp = ca.toLowerCase().localeCompare(cb.toLowerCase());
      if (cmp !== 0) return cmp;
    }
  }

  // Shorter string comes first if all compared chunks are equal
  return chunksA.length - chunksB.length;
}
