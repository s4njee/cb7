/** Shared contract between the Reader shell (chrome + drawers) and the concrete
 *  readers (comic / text / pdf). Each sub-reader owns its own paging, progress,
 *  TOC and bookmarks, reporting state up and exposing an imperative handle the
 *  shell drives from the chrome.
 *
 *  Positions are opaque to the shell: an EPUB uses a CFI string, a comic/PDF a
 *  page index. The shell only round-trips them through `getPosition`/`goTo`,
 *  which is what lets one back-stack serve all three readers. */
import type { ReactNode } from "react";

export interface ChapterItem {
  key: string;
  num: string; // roman numeral
  title: string;
  target: string | number; // href (epub) or page index
  active: boolean;
}

export interface BookmarkItem {
  key: string;
  title: string;
  label: string;
  target: string | number; // cfi (epub) or page index
}

export interface HighlightItem {
  key: string;
  /** Swatch id from lib/highlights, not a raw CSS color. */
  color: string;
  /** Excerpt of the highlighted text, for the drawer list. */
  text: string;
  target: string; // cfi
}

/** One in-book text-search result, as a reader reports it to the shell. */
export interface SearchHit {
  /** Opaque jump target the reader's `goTo` understands (href / page index). */
  target: string | number;
  /** Human label: "Page 12" (PDF) or a section title (EPUB). */
  label: string;
  /** First-match snippet for the list. */
  snippet: string;
  /** Matches in this section/page. */
  count: number;
}

export interface ReaderReportedState {
  pageLabel: string | null;
  percent: number | null;
  chapters: ChapterItem[];
  hasContents: boolean; // comics have no chapters → false
  isBookmarked: boolean;
  bookmarks: BookmarkItem[];
  highlights: HighlightItem[];
  /** Total addressable pages: comic/PDF page count, or the EPUB location count
   *  once the index is built. Null while unknown. */
  pageCount: number | null;
  /** Current 1-based page within `pageCount`. */
  pageNumber: number | null;
  /** Whether goToPage / goToPercent work right now. False for an EPUB until
   *  `book.locations` is generated — seeking before then lands arbitrarily. */
  canSeek: boolean;
  /** True when the final page/location is currently visible — the shell uses a
   *  further `next()` from here as the "finished the book" gesture. Spread
   *  modes can show the last page while `pageNumber < pageCount`, so only the
   *  concrete reader can answer this. */
  atEnd: boolean;
  /** Comic thumbnail strip, rendered above the progress row in the chrome. */
  bottomExtra: ReactNode | null;
}

export interface ReaderApi {
  next: () => void;
  prev: () => void;
  toggleBookmark: () => void;
  goToChapter: (target: string | number) => void;
  goToBookmark: (item: BookmarkItem) => void;
  /** Current position, for the shell to push on its back-stack before a jump. */
  getPosition: () => string | number | null;
  /** Jump to a position previously returned by `getPosition`. */
  goTo: (target: string | number) => void;
  /** 1-based, within `pageCount`. */
  goToPage: (n: number) => void;
  /** 0–100. */
  goToPercent: (pct: number) => void;
  goToHighlight?: (item: HighlightItem) => void;
  removeHighlight?: (key: string) => void;
  /** In-book text search. Resolves to a list of per-section/page hits.
   *  Implemented by the EPUB and PDF readers; comics return []. */
  search?: (query: string) => Promise<SearchHit[]>;
}

export const EMPTY_READER_STATE: ReaderReportedState = {
  pageLabel: null,
  percent: null,
  chapters: [],
  hasContents: false,
  isBookmarked: false,
  bookmarks: [],
  highlights: [],
  pageCount: null,
  pageNumber: null,
  canSeek: false,
  atEnd: false,
  bottomExtra: null,
};
