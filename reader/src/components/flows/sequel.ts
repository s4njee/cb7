/** Pure sequel/"up next" heuristic. Records carry no series field (see
 *  CONTRACT.md), so we infer one from the title: strip a trailing volume /
 *  number token to get a series prefix, then, among sibling records sharing
 *  that prefix, pick the one whose number is the smallest greater than the
 *  current volume. Kept pure + regex-driven so the parsing is unit-testable.
 *
 *  The heuristic is deliberately self-correcting: a bare trailing number
 *  ("Fahrenheit 451") parses as volume 451, but no sibling shares the prefix
 *  "Fahrenheit" with a larger number, so nothing is ever surfaced. Only real
 *  numbered series (which have siblings) produce an "up next". */
import type { WebComicRecord } from "../../lib/api";

export interface TitleParts {
  /** Series name with the trailing volume token removed, normalized. */
  prefix: string;
  /** Volume/issue number, or null when the title has no trailing number. */
  volume: number | null;
}

/** Trailing "<marker> <number>": v01, Vol. 3, Volume 5, Book 2, Part 4,
 *  Chapter 7, Ch. 7, No. 8, #12. The marker is optional so a bare trailing
 *  number is caught too (case B, below). */
const MARKED = /^(.+?)[\s,:.–—-]*\b(?:v|vol|volume|book|bk|part|pt|no|chapter|ch|issue)\.?\s*0*(\d{1,4})\s*$/i;
const HASH = /^(.+?)[\s,:.–—-]*#\s*0*(\d{1,4})\s*$/;
const BARE = /^(.+?)\s+0*(\d{1,4})\s*$/;

/** Trim trailing separators/whitespace left behind after removing the token. */
function tidyPrefix(s: string): string {
  return s.replace(/[\s,:.–—-]+$/, "").trim();
}

export function parseTitle(title: string): TitleParts {
  const t = title.trim();
  for (const re of [HASH, MARKED, BARE]) {
    const m = t.match(re);
    if (m) {
      const prefix = tidyPrefix(m[1]);
      const volume = parseInt(m[2], 10);
      if (prefix && Number.isFinite(volume)) return { prefix, volume };
    }
  }
  return { prefix: t, volume: null };
}

function samePrefix(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** From a pool of candidate records, pick the next volume after `current`:
 *  same series prefix, smallest volume strictly greater than the current one,
 *  same media type. Returns null when the current title isn't numbered or no
 *  sibling qualifies. */
export function pickSequel(
  current: WebComicRecord,
  candidates: WebComicRecord[],
): WebComicRecord | null {
  const cur = parseTitle(current.title);
  if (cur.volume == null) return null;

  let best: { rec: WebComicRecord; vol: number } | null = null;
  for (const rec of candidates) {
    if (rec.id === current.id) continue;
    if (rec.mediaType !== current.mediaType) continue;
    const p = parseTitle(rec.title);
    if (p.volume == null) continue;
    if (!samePrefix(p.prefix, cur.prefix)) continue;
    if (p.volume <= cur.volume) continue;
    if (best == null || p.volume < best.vol) best = { rec, vol: p.volume };
  }
  return best?.rec ?? null;
}
