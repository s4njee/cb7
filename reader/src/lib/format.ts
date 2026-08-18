/** Progress math, status labels, metadata lines, roman numerals. */
import type { WebComicRecord } from "./api";
import type { ImportReport } from "./transport";

const ROMAN = [
  "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
  "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
];

export function roman(n: number): string {
  return ROMAN[n] ?? String(n + 1);
}

/**
 * Percent read. Books store whole-book progress in `lastPercent` (EPUB CFI
 * flow) — prefer it whenever present, since their `pageCount` is a spine or
 * estimate count and `lastPage` stays null. Paged media derive from
 * (lastPage + 1) / pageCount.
 */
export function percentRead(r: WebComicRecord): number {
  if (r.mediaType === "book" && r.lastPercent != null) {
    return clampPct(r.lastPercent);
  }
  if (r.lastPage == null || r.pageCount === 0) return 0;
  return clampPct(Math.round(((r.lastPage + 1) / r.pageCount) * 100));
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function hasStarted(r: WebComicRecord): boolean {
  return (
    r.lastRead != null ||
    r.lastPage != null ||
    (r.lastLocation != null && r.lastLocation !== "") ||
    (r.lastPercent != null && r.lastPercent > 0)
  );
}

export function isFinished(r: WebComicRecord): boolean {
  return percentRead(r) >= 100;
}

export function statusLabel(r: WebComicRecord): string {
  if (!hasStarted(r)) return "Not started";
  if (isFinished(r)) return "Finished";
  return `${percentRead(r)}% read`;
}

/** `CBZ · 24 pages` — records have no author, so metadata uses ext + pages. */
export function metaLine(r: WebComicRecord): string {
  const ext = (r.fileExt || "").replace(/^\./, "").toUpperCase() || r.mediaType.toUpperCase();
  if (r.pageCount > 0) {
    return `${ext} · ${r.pageCount} ${r.pageCount === 1 ? "page" : "pages"}`;
  }
  return ext;
}

export function kindLabel(r: WebComicRecord): string {
  return r.mediaType === "comic" ? "Comic" : "Novel";
}

/** Human file size for detail surfaces (`1.2 MB`, `< 0.1 MB`). */
/** A short human toast for a multi-file import that added nothing: the reason
 *  the picker/drop/open produced no shelf entries. Single "Added N" messages
 *  are built by callers; this is the no-success path. */
export function importReportMessage(report: ImportReport): string {
  const { skipped, failed } = report;
  const parts: string[] = [];
  if (failed.length) {
    parts.push(
      failed.length === 1
        ? `1 file couldn't be added (${failed[0].reason})`
        : `${failed.length} files couldn't be added`,
    );
  }
  if (skipped.length) {
    parts.push(
      skipped.length === 1
        ? `1 file skipped (${skipped[0].reason})`
        : `${skipped.length} files skipped`,
    );
  }
  if (!parts.length) return "Nothing to add.";
  return parts.join(" · ");
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return "< 0.1 MB";
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** Relative “last read” for detail sheets; empty when never opened. */
export function lastReadLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60_000) return "Just now";
  if (diff < 60 * 60_000) return `${Math.max(1, Math.round(diff / 60_000))} min ago`;
  if (diff < day) return `${Math.max(1, Math.round(diff / (60 * 60_000)))} h ago`;
  if (diff < 7 * day) return `${Math.max(1, Math.round(diff / day))} d ago`;
  try {
    return new Date(t).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

export type ReaderFormat = "comic" | "epub" | "pdf";

/**
 * Which reader to mount. Resolves by media type / extension first, then falls
 * back to progress shape for books whose extension is missing or unknown: an
 * `epubcfi` location implies EPUB, a real page count without one implies PDF.
 *
 * Mirrors `determineReaderFormat` in the CB8 server's own SPA
 * (server/src/renderer/pages/readerPageHelpers.ts) — the two must agree, or a
 * book opens as a different format depending on which client you use.
 */
export function readerFormat(r: WebComicRecord): ReaderFormat {
  const ext = (r.fileExt || "").replace(/^\./, "").toLowerCase();
  if (r.mediaType === "comic" || ext === "cbz" || ext === "cbr") return "comic";
  if (ext === "epub") return "epub";
  if (ext === "pdf") return "pdf";
  if (r.pageCount === 0 && !r.lastPage) return "epub";
  if (r.lastLocation && r.lastLocation.includes("epubcfi")) return "epub";
  if (r.pageCount > 0 && !r.lastLocation) return "pdf";
  return "epub";
}

export function titleInitials(name: string | null | undefined): string {
  if (!name) return "G";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "G";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
