import type { EpubBook } from './EpubReaderTypes';

/**
 * @file epubReaderLinks.ts
 * EPUB Internal Link Resolution
 *
 * 
 * Architecture overview for Junior Devs:
 * EPUB chapters link to each other with relative hrefs (`../text/ch2.xhtml#top`),
 * absolute paths, and CFI fragments — and they also contain external links we
 * must NOT follow inside the reader. This module normalises an href into a
 * canonical spine path and then resolves it to a spine index the reader can jump
 * to. Getting this right is what makes a book's table-of-contents and footnotes
 * actually work.
 */

/**
 * Normalise an EPUB href into a canonical spine path (or pass through CFI).
 *  Returns `null` for external/unsupported schemes (http, mailto, etc.)
 *          so they are never navigated internally. CFI links are returned as-is.
 *          Relative paths are resolved against the current/section base, handling
 *          `.` and `..` segments; absolute paths are stripped to a root-relative
 *          form. Any `#fragment` is preserved.
 * @param href The raw href from the EPUB content.
 * @param sectionHref The href of the section the link belongs to, if known.
 * @param currentSectionHref The currently displayed section's href, as a fallback base.
 * @returns The normalised target, or `null` if it should not be followed.
 */
export function normalizeInternalHref(
  href: string,
  sectionHref?: string | null,
  currentSectionHref?: string | null,
): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('epubcfi(')) return trimmed;
  if (/^(?:https?:|mailto:|tel:|javascript:|data:|blob:)/i.test(trimmed)) return null;

  const [pathPart = '', hashPart] = trimmed.split('#', 2);
  const hash = hashPart !== undefined ? `#${hashPart}` : '';
  const baseHref = sectionHref || currentSectionHref || '';

  if (!pathPart) {
    return baseHref ? `${baseHref}${hash}` : trimmed;
  }

  if (pathPart.startsWith('/')) {
    return `${pathPart.replace(/^\/+/, '')}${hash}`;
  }

  const baseParts = baseHref.split('/').slice(0, -1);
  const targetParts = pathPart.split('/');
  for (const part of targetParts) {
    if (!part || part === '.') continue;
    if (part === '..') baseParts.pop();
    else baseParts.push(part);
  }

  return `${baseParts.join('/')}${hash}`;
}

/**
 * Resolve an href to a destination the reader can display.
 *  Normalises the href, then looks it up in the book's spine. Returns a
 *          numeric spine index when the target maps to a section (trying both the
 *          normalised path and a slash-stripped variant), the raw CFI string for
 *          CFI links, or the normalised path as a last resort. Returns `null`
 *          for links that must not be followed.
 * @param book The loaded EPUB book (provides the spine), or `null`.
 * @param href The raw href to resolve.
 * @param sectionHref The href of the section the link belongs to, if known.
 * @param currentSectionHref The currently displayed section's href, as a fallback base.
 * @returns A spine index, a CFI/path string, or `null`.
 */
export function resolveEpubDisplayTarget(
  book: EpubBook | null,
  href: string,
  sectionHref?: string | null,
  currentSectionHref?: string | null,
): string | number | null {
  const normalized = normalizeInternalHref(href, sectionHref, currentSectionHref);
  if (!normalized) return null;
  if (normalized.startsWith('epubcfi(')) return normalized;

  const section = book?.spine?.get(normalized);
  if (section && typeof section.index === 'number') {
    return section.index;
  }

  const withoutLeadingSlash = normalized.replace(/^\/+/, '');
  const sectionWithoutSlash = book?.spine?.get(withoutLeadingSlash);
  if (sectionWithoutSlash && typeof sectionWithoutSlash.index === 'number') {
    return sectionWithoutSlash.index;
  }

  return normalized;
}
