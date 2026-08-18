/**
 * @module
 * Parse Series / Volume / Chapter Info From a Filename
 *
 * Architecture overview for Junior Devs:
 * Comic files are usually named with conventions that encode the series, volume,
 * and chapter (e.g. "Naruto v01 c003.cbz"). This pure module turns that filename
 * into structured data so the library can group books by Series -> Volume ->
 * Chapter. It's heavily unit-tested (`seriesParser.test.ts`) because filenames
 * are wildly inconsistent in the real world.
 *
 * Recognized patterns include:
 *   "Title v01"               -> { seriesName: 'Title', volumeNumber: 1 }
 *   "Title Vol. 3 Ch. 12"     -> { seriesName: 'Title', volumeNumber: 3, chapterNumber: 12 }
 *   "Title #005"              -> { seriesName: 'Title', chapterNumber: 5 }
 *   "Title (2020) #01"        -> { seriesName: 'Title', chapterNumber: 1 }
 *   "[Group] Title v01"       -> { seriesName: 'Title', volumeNumber: 1 }
 *   "Title v01 (Digital) (f)" -> { seriesName: 'Title', volumeNumber: 1 }
 *   "Title c001-005"          -> { seriesName: 'Title', chapterNumber: 1 }
 *
 * When nothing matches, all fields come back null (treated as a standalone book).
 */

/** Parsed series metadata; any field may be null when unknown. */
export interface SeriesInfo {
  seriesName: string | null;
  volumeNumber: number | null;
  chapterNumber: number | null;
}

/** Collapse runs of whitespace and trim, for a tidy series name. */
export function normalizeSeriesName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').trim();
}

/**
 * Remove a leading release-date prefix (YYYY / YYYYMM / YYYYMMDD).
 *
 * Used by both the parser and the ingest service's display-title logic,
 * so "199305 X-Force v1 022.cbz" shows as "X-Force v1 022".
 *
 * @param s The filename or filename-derived title.
 * @returns The input with any leading date prefix stripped.
 */
export function stripLeadingReleaseDate(s: string): string {
  return s.replace(LEADING_DATE_RE, '');
}

// Volume/chapter markers require a prefix so series with numeric names
// ("7SEEDS", "20th Century Boys") don't get eaten.
const VOL_RE  = /\b(?:v(?:ol(?:ume)?)?\.?\s*)(\d+(?:\.\d+)?)\b/i;
const CH_RE   = /(?:\bc(?:h(?:apter)?)?\.?\s*|#)(\d+(?:\.\d+)?)(?:-\d+(?:\.\d+)?)?\b/i;
const YEAR_RE = /\((\d{4})\)/;

// Leading scanlation group: "[Stick]" or "(Group)" at very start.
const LEADING_GROUP_RE = /^\s*[\[(][^\])]+[\])]\s*/;

// Trailing bracketed metadata: (Digital), (f), {Group}, [Tag], etc.
const TRAILING_TAG_RE = /\s*[\[({][^\])}]+[\])}]\s*$/;

// Leading release-date prefix: "199305 X-Force …" or "2010 Spider-Man …".
// Marvel/DC scans commonly prefix the filename with YYYY, YYYYMM, or YYYYMMDD.
// We require 4+ digits followed by whitespace so series with numeric names
// like "7SEEDS" (1 digit) or "20th Century Boys" (digits + letters) are safe.
const LEADING_DATE_RE = /^\d{4,8}\s+/;

// Bare 1-3 digit issue number following a volume marker, e.g. "v1 022" in
// "X-Force v1 022". Restricted to ≤3 digits so a trailing year (e.g. "v01 1998")
// is not mistaken for an issue.
const VOL_THEN_ISSUE_RE = /\bv(?:ol(?:ume)?)?\.?\s*\d+(?:\.\d+)?\s+(\d{1,3})\b/i;

/**
 * Parse a filename into series name, volume, and chapter numbers.
 * @param filename The file's name (extension optional).
 * @returns A `SeriesInfo`; fields are null when the pattern can't be detected.
 */
export function parseSeriesFromFilename(filename: string): SeriesInfo {
  if (!filename) return { seriesName: null, volumeNumber: null, chapterNumber: null };

  const noExt = filename.replace(/\.[^./\\]+$/, '');
  // Dots act as separators ("Title.v01") except when part of a decimal ("v1.5").
  // Then strip a leading YYYY/YYYYMM/YYYYMMDD release-date prefix so files like
  // "199305 X-Force v1 022" group under "X-Force" rather than "199305 X-Force".
  const cleaned = noExt
    .replace(/\.(?!\d)/g, ' ')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_DATE_RE, '');

  const volMatch = cleaned.match(VOL_RE);
  const chMatch  = cleaned.match(CH_RE);
  const volumeNumber  = volMatch ? parseFloat(volMatch[1]) : null;
  let chapterNumber   = chMatch  ? parseFloat(chMatch[1])  : null;

  // If we found a volume but no explicit chapter marker, look for a bare
  // 1-3 digit number right after the volume — that's the issue/chapter in
  // "Series vN NNN" filenames common in Marvel/DC scans.
  if (volumeNumber != null && chapterNumber == null) {
    const issueMatch = cleaned.match(VOL_THEN_ISSUE_RE);
    if (issueMatch) chapterNumber = parseFloat(issueMatch[1]);
  }

  if (volumeNumber == null && chapterNumber == null) {
    return { seriesName: null, volumeNumber: null, chapterNumber: null };
  }

  // Series = everything before the first volume/chapter/year marker.
  let cutIndex = cleaned.length;
  for (const re of [VOL_RE, CH_RE, YEAR_RE]) {
    const m = cleaned.match(re);
    if (m?.index != null && m.index < cutIndex) cutIndex = m.index;
  }
  let series = cleaned.slice(0, cutIndex);

  // Strip leading scanlation group (only once, at start).
  series = series.replace(LEADING_GROUP_RE, '');

  // Strip any trailing bracketed tags that fall between series and marker.
  // Loop because there can be several: "Title (Group) (Digital)".
  let prev: string;
  do { prev = series; series = series.replace(TRAILING_TAG_RE, ''); } while (series !== prev);

  // Strip trailing separators.
  series = series.replace(/[\s\-–—|•·~]+$/, '').trim();

  const normalized = normalizeSeriesName(series);
  return {
    seriesName: normalized.length > 0 ? normalized : null,
    volumeNumber,
    chapterNumber,
  };
}
