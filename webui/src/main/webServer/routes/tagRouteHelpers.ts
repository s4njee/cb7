/**
 * @module
 * Tag Request Parsing and Diffing Helpers
 *
 * Architecture overview for Junior Devs:
 * The tag routes accept user-supplied tag lists and tag names from URLs, neither
 * of which we can trust. This module holds the pure rules behind those routes:
 * cleaning an incoming tag array, working out what actually changed versus what
 * is already stored, and decoding a tag name out of a URL path.
 *
 * `normalizeTagList` is the input gate — it rejects non-arrays and otherwise
 * trims, drops blanks, and de-duplicates (order-preserving) so the rest of the
 * code sees a clean list. `diffTags` then computes the minimal added/removed
 * sets so a route only writes the real changes rather than rewriting every tag.
 * Keeping these pure makes them trivial to unit test and keeps the handlers thin.
 */

/** Result of validating an incoming tag array: the clean tags, or an error. */
export type TagListValidation =
  | { ok: true; tags: string[] }
  | { ok: false; error: string };

/** The change-set between a current and a desired tag list. */
export interface TagDiff {
  added: string[];
  removed: string[];
  next: string[];
}

/**
 * Validate and clean an untrusted tag array.
 * Requires an array; trims each entry, drops blanks, and removes
 *          duplicates while preserving first-seen order.
 * @param value The raw value from the request body.
 * @returns A tagged result with the cleaned tags, or an error message.
 */
export function normalizeTagList(value: unknown): TagListValidation {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'Provide "tags" (array)' };
  }

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const item of value) {
    const tag = typeof item === 'string' ? item.trim() : '';
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }

  return { ok: true, tags };
}

/**
 * Compute which tags were added and removed.
 * Compares the current tags against the desired set; `next` echoes the
 *          desired list so callers have the full picture in one object.
 * @param currentTags The tags currently stored.
 * @param nextTags The desired tags after the update.
 * @returns The added, removed, and resulting tag lists.
 */
export function diffTags(currentTags: string[], nextTags: string[]): TagDiff {
  const current = new Set(currentTags);
  const next = new Set(nextTags);

  return {
    added: nextTags.filter((tag) => !current.has(tag)),
    removed: currentTags.filter((tag) => !next.has(tag)),
    next: nextTags,
  };
}

/**
 * Decode a tag name from a URL path segment.
 * @param value The raw (URL-encoded) path segment.
 * @returns The decoded, trimmed tag name.
 */
export function parseTagNameFromPath(value: string): string {
  return decodeURIComponent(value).trim();
}
