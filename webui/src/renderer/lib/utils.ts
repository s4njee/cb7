import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const GROUP_NONE_KEY = '__none__';

export const PLACEHOLDER_BOOK_SVG_DATA_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 96" preserveAspectRatio="xMidYMid slice">
       <rect width="64" height="96" fill="#1c1c1c"/>
       <g fill="none" stroke="#444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
         <path d="M18 24h28v48H18z"/>
         <path d="M18 24v48"/><path d="M22 32h20"/><path d="M22 40h20"/><path d="M22 48h14"/>
       </g>
     </svg>`,
  );

export function itemCountLabel(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`;
}

export function numberLabel(key: string | null | undefined, fallback: string, noun: string): string {
  if (!key || key === GROUP_NONE_KEY) return fallback;
  const value = Number(key);
  if (!Number.isFinite(value)) return fallback;
  return `${noun} ${Number.isInteger(value) ? value.toFixed(0) : String(value)}`;
}

/** Minimal record shape needed to describe a card's reading state. */
interface CaptionRecord {
  fileExt: string;
  mediaType: 'comic' | 'book';
  pageCount: number;
  lastPage: number | null;
  lastPercent?: number | null;
}

export function isFinished(record: Pick<CaptionRecord, 'pageCount' | 'lastPage' | 'lastPercent'>): boolean {
  return (
    (record.lastPage != null && record.pageCount > 0 && record.lastPage >= record.pageCount - 1) ||
    (record.lastPercent != null && record.lastPercent >= 100)
  );
}

export function progressPercentFor(record: Pick<CaptionRecord, 'pageCount' | 'lastPage' | 'lastPercent'>): number {
  // lastPage is 0-indexed, so pages-read = lastPage + 1.
  if (record.pageCount > 0 && record.lastPage != null) {
    return Math.max(1, Math.min(100, Math.round(((record.lastPage + 1) / record.pageCount) * 100)));
  }
  // Reflowable EPUBs report a whole-book percentage instead of a page index.
  if (record.lastPercent != null) {
    return Math.max(0, Math.min(100, Math.round(record.lastPercent)));
  }
  return 0;
}

/** One-line muted caption for a card: reading state when started, format + length otherwise. */
export function comicCaption(record: CaptionRecord): string {
  if (isFinished(record)) return 'Finished';
  if (record.lastPage != null && record.pageCount > 0) {
    return `Page ${record.lastPage + 1} of ${record.pageCount}`;
  }
  // Reflowable EPUBs report a whole-book percentage instead of a page index.
  if (record.lastPercent != null) {
    return `${Math.max(0, Math.min(100, Math.round(record.lastPercent)))}% read`;
  }
  // Unstarted: quiet format + length line, e.g. "CBZ · 24 pages".
  const ext = (record.fileExt || '').toUpperCase();
  const unit = record.mediaType === 'book' ? 'chapter' : 'page';
  const count =
    record.pageCount > 0 ? `${record.pageCount} ${unit}${record.pageCount === 1 ? '' : 's'}` : '';
  return [ext, count].filter(Boolean).join(' · ');
}
