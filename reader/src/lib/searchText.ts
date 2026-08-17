/** Pure text search helpers — no DOM, no pdf.js, no Readium.
 *
 *  Two uses, one module:
 *  - In-book search (EPUB spine / PDF page text) — case-insensitive substring
 *    matches with a snippet, capped result count.
 *  - Library search beyond titles — a record matcher with field prefixes
 *    (`author:`, `series:`, `tag:`), shared by the local shelf filter so
 *    client and tests agree.
 */

/** A minimal record shape for library search. Kept structural (not importing
 *  WebComicRecord) so the matcher stays pure and unit-testable. */
export interface SearchableBook {
  title: string;
  author?: string | null;
  series?: string | null;
  tags?: string[];
  collections?: string[];
}

export interface TextMatch {
  /** Index into the source string where the match starts. */
  start: number;
  /** Length of the matched text (the query, as found). */
  length: number;
  /** A window of source text around the match, for the results list. */
  snippet: string;
}

/** Collapse whitespace so a search term spanning a line break still matches. */
export function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, " ");
}

/** Find every (case-insensitive) occurrence of `query` in `text`.
 *
 *  `limit` caps the result set so a book with thousands of "the"s doesn't
 *  flood the UI. Snippets are ~90 chars centered on the match. Text is
 *  whitespace-normalized first, so a query spanning a line break still matches;
 *  offsets/snippets are relative to the normalized text (the only thing
 *  callers consume).
 */
export function findMatches(
  text: string,
  query: string,
  limit = 200,
): TextMatch[] {
  const q = query.trim();
  if (!q) return [];
  const normalized = normalizeSpaces(text);
  const lower = normalized.toLocaleLowerCase();
  const needle = q.toLocaleLowerCase();
  const matches: TextMatch[] = [];
  let from = 0;
  const SNIPPET = 90;
  while (matches.length < limit) {
    const idx = lower.indexOf(needle, from);
    if (idx < 0) break;
    const start = Math.max(0, idx - Math.floor(SNIPPET / 4));
    const end = Math.min(normalized.length, idx + q.length + Math.floor((SNIPPET * 3) / 4));
    const snippet =
      (start > 0 ? "…" : "") + normalized.slice(start, end).trim() + (end < normalized.length ? "…" : "");
    matches.push({ start: idx, length: q.length, snippet });
    from = idx + q.length;
  }
  return matches;
}

/** A per-section/per-page search result, as the reader surfaces it. */
export interface SectionHit {
  /** Opaque target the reader can jump to (href or page index). */
  target: string | number;
  /** Human label for the result ("Page 12", a section title). */
  label: string;
  /** First-match snippet for the list. */
  snippet: string;
  /** How many matches in this section/page. */
  count: number;
}

/** Parse a query into an optional field + the rest, so `author:xyz` matches
 *  only the author. Recognized prefixes: `author:`, `series:`, `tag:`,
 *  `collection:` (or `col:`). Returns `{ field, term }` with `field` null for
 *  an unprefixed query. */
export function parseLibraryQuery(
  query: string,
): { field: "author" | "series" | "tag" | "collection" | null; term: string } {
  const m = query.trim().match(/^(author|series|tag|collection|col):\s*(.*)$/i);
  if (!m) return { field: null, term: query.trim().toLowerCase() };
  const field = m[1].toLowerCase() === "col" ? "collection" : (m[1].toLowerCase() as "author" | "series" | "tag" | "collection");
  return { field, term: m[2].trim().toLowerCase() };
}

/** Does `book` match the library query?
 *
 *  A prefixed query (`series:`) matches only that field; an unprefixed query
 *  matches title, author, series, tags, and collections — so a search finds
 *  "the author's series" and a tag without knowing which field it lives in.
 *  Matching is case-insensitive substring (consistent with in-book search).
 */
export function matchesLibraryQuery(book: SearchableBook, query: string): boolean {
  const { field, term } = parseLibraryQuery(query);
  if (!term) return false;
  const has = (value: string | null | undefined) =>
    !!value && value.toLowerCase().includes(term);

  switch (field) {
    case "author":
      return has(book.author);
    case "series":
      return has(book.series);
    case "tag":
      return (book.tags ?? []).some((t) => t.toLowerCase().includes(term));
    case "collection":
      return (book.collections ?? []).some((c) => c.toLowerCase().includes(term));
    case null:
      return (
        has(book.title) ||
        has(book.author) ||
        has(book.series) ||
        (book.tags ?? []).some((t) => t.toLowerCase().includes(term)) ||
        (book.collections ?? []).some((c) => c.toLowerCase().includes(term))
      );
  }
}

/** Collapse multiple matches of one section into a single `SectionHit`. */
export function hitsPerSection(
  sections: Array<{ target: string | number; label: string; text: string }>,
  query: string,
  limit = 200,
): SectionHit[] {
  const hits: SectionHit[] = [];
  for (const section of sections) {
    const matches = findMatches(section.text, query, limit);
    if (!matches.length) continue;
    hits.push({
      target: section.target,
      label: section.label,
      snippet: matches[0].snippet,
      count: matches.length,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
