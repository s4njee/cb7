/**
 * Offline-pin status labels and stable progress copy for the Downloads sheet
 * and book detail. Keeps totals from jittering by rounding size and only
 * changing unit fractions when the underlying integers move.
 */

export type DownloadStatus =
  | "queued"
  | "active"
  | "paused"
  | "failed"
  | "complete";

export interface DownloadLike {
  comicId: number;
  title: string;
  mediaType: "comic" | "book";
  total: number;
  done: number;
  bytes: number;
  complete: boolean;
  status?: DownloadStatus;
  lastError?: string | null;
  error?: string | null;
  resumable?: boolean;
}

/** Round bytes for display (0.1 MB steps above 0.1 MB). */
export function formatDownloadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return "< 0.1 MB";
  if (mb < 10) return `${(Math.round(mb * 10) / 10).toFixed(1)} MB`;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function resolveDownloadStatus(d: DownloadLike): DownloadStatus {
  if (d.status) return d.status;
  if (d.complete) return "complete";
  const err = d.lastError ?? d.error;
  if (err) {
    if (/cancel/i.test(err)) return "paused";
    return "failed";
  }
  return d.done > 0 ? "paused" : "queued";
}

export function statusLabel(status: DownloadStatus, d: DownloadLike): string {
  switch (status) {
    case "queued":
      return d.resumable || d.done > 0 ? "Resuming…" : "Starting…";
    case "active":
      return "Downloading";
    case "paused":
      return d.resumable || d.done > 0
        ? "Paused — will resume from here"
        : "Paused";
    case "failed":
      return "Failed";
    case "complete":
      return "Complete";
  }
}

/**
 * Stable progress line: unit fraction + size. Avoids reflowing on sub-MB
 * noise by using rounded sizes only.
 */
export function progressDetail(d: DownloadLike): string {
  const status = resolveDownloadStatus(d);
  const size = formatDownloadBytes(d.bytes);
  const units =
    d.total > 0
      ? d.mediaType === "comic"
        ? `${d.done} of ${d.total} pages`
        : d.complete
          ? "1 of 1 file"
          : `${d.done} of ${d.total} file`
      : null;

  if (status === "complete") {
    return size;
  }
  if (status === "failed") {
    const err = (d.lastError ?? d.error ?? "").trim();
    const short = err.length > 72 ? `${err.slice(0, 69)}…` : err;
    const base = units ? `${units} · ${size}` : size;
    return short ? `${base} · ${short}` : base;
  }
  if (status === "paused") {
    const base = units ? `${units} · ${size}` : size;
    return d.resumable || d.done > 0
      ? `${base} · Retry resumes`
      : base;
  }
  // active / queued
  if (units) return `${units} · ${size}`;
  return size;
}

/** 0–100 for the track; null when unknown. */
export function progressPercent(d: DownloadLike): number | null {
  if (d.total <= 0) return d.complete ? 100 : null;
  return Math.min(100, Math.round((d.done / d.total) * 100));
}

/** Whether the row should offer Retry (resume). */
export function canRetryDownload(d: DownloadLike): boolean {
  const s = resolveDownloadStatus(d);
  return s === "paused" || s === "failed";
}

/** Whether the row should offer Cancel. */
export function canCancelDownload(d: DownloadLike): boolean {
  const s = resolveDownloadStatus(d);
  return s === "active" || s === "queued";
}
