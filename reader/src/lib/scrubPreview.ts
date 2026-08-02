/**
 * Live scrubber destination labels — page/location, optional spread range,
 * chapter title, and percent — so the reader sees where a drag will land
 * before release.
 *
 * Page numbers are always in reading (document) order. RTL only flips the
 * visual page layout; it must not reverse the numeric progression in chrome.
 */

export interface ScrubChapter {
  title: string;
  /** Page index (0-based) for comics/PDF; href/CFI for EPUB (ignored for map). */
  target: string | number;
}

export interface ScrubPreviewInput {
  /** 0–100 scrub position. */
  scrubPct: number;
  pageCount: number | null;
  /** Two-page spread: label both pages when the destination has a partner. */
  spread: boolean;
  chapters?: ScrubChapter[];
  /** EPUB scrolled flow uses “Location” instead of “Page”. */
  locationMode?: boolean;
}

export interface ScrubPreview {
  /** Primary line for the page label + bubble, e.g. `Pages 12–13 of 240`. */
  label: string;
  /** Chapter title under the bubble when mappable. */
  chapter: string | null;
  /** Rounded 0–100 for the % readout. */
  percent: number;
  /** 1-based destination page (left/start of a spread). */
  page: number | null;
  /** 1-based right page of a spread, if any. */
  pageEnd: number | null;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** 1-based page (or location index) for a scrub percent. */
export function pageAtPercent(scrubPct: number, pageCount: number): number {
  if (pageCount <= 0) return 1;
  return clamp(Math.round((scrubPct / 100) * pageCount) || 1, 1, pageCount);
}

/**
 * Chapter whose start is at or before `page1` (1-based), for page-indexed TOC
 * entries only. EPUB href targets are skipped.
 */
export function chapterAtPage(
  page1: number,
  chapters: ScrubChapter[] | undefined,
): string | null {
  if (!chapters?.length || page1 < 1) return null;
  // 0-based index for comparison with page-index targets.
  const idx = page1 - 1;
  let best: string | null = null;
  let bestTarget = -1;
  for (const ch of chapters) {
    if (typeof ch.target !== "number" || !Number.isFinite(ch.target)) continue;
    if (ch.target <= idx && ch.target >= bestTarget) {
      bestTarget = ch.target;
      best = ch.title;
    }
  }
  return best;
}

export function scrubPreview(input: ScrubPreviewInput): ScrubPreview {
  const percent = clamp(Math.round(input.scrubPct), 0, 100);
  const count = input.pageCount;

  if (count == null || count <= 0) {
    return {
      label: `${percent}%`,
      chapter: null,
      percent,
      page: null,
      pageEnd: null,
    };
  }

  const page = pageAtPercent(input.scrubPct, count);
  let pageEnd: number | null = null;
  if (input.spread && page < count) {
    // Spread pairing is even-left for simple cases (PDF); comics with wide
    // pages may differ at runtime, but preview uses the common rule.
    const left = page % 2 === 0 ? page - 1 : page;
    const start = clamp(left < 1 ? page : left, 1, count);
    if (start < count && start === page) {
      pageEnd = start + 1;
    } else if (start < page) {
      // Landed on the right half of a pair — show the full spread.
      pageEnd = page;
      return finalize(start, pageEnd, count, percent, input);
    }
  }

  return finalize(page, pageEnd, count, percent, input);
}

function finalize(
  page: number,
  pageEnd: number | null,
  count: number,
  percent: number,
  input: ScrubPreviewInput,
): ScrubPreview {
  const unit = input.locationMode ? "Location" : "Page";
  const units = input.locationMode ? "Locations" : "Pages";
  const label =
    pageEnd != null && pageEnd !== page
      ? `${units} ${page}–${pageEnd} of ${count}`
      : `${unit} ${page} of ${count}`;
  return {
    label,
    chapter: chapterAtPage(page, input.chapters),
    percent,
    page,
    pageEnd,
  };
}
