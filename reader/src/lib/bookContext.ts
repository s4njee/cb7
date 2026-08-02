/**
 * Source / availability context for a book.
 *
 * The unified {@link WebComicRecord} model intentionally hides storage, but
 * readers still need to know whether a title is on-device, only on the server,
 * already saved, downloading, or pinned offline. Labels and action verbs live
 * here so the action sheet, downloads list, and reader chrome cannot drift.
 */

import type { WebComicRecord } from "./api";

function isLocal(record: WebComicRecord): boolean {
  return record.source === "local";
}

/** Explicit verbs — never "Delete", which is ambiguous about catalog vs file. */
export const ACTION_LABELS = {
  saveToDevice: "Save to device",
  removeLocalCopy: "Remove local copy",
  removeDownload: "Remove download",
  cancelDownload: "Cancel download",
} as const;

export type SourceTone = "local" | "server" | "offline" | "muted";

export interface SourceBadge {
  /** Short pill text. */
  label: string;
  tone: SourceTone;
  /** Optional second line under the title (action sheet). */
  detail?: string;
}

export interface BookContextInput {
  record: WebComicRecord;
  /** Current server origin (for matching local downloads back to a server id). */
  serverUrl?: string | null;
  /** On-device shelf, used to detect “already saved from this server”. */
  localBooks?: WebComicRecord[];
  /** Server comic is offline-pinned (complete). */
  offlinePinned?: boolean;
  /** Server comic has an in-flight pin. */
  offlineDownloading?: boolean;
}

function normServer(url: string | null | undefined): string {
  if (!url) return "";
  return url.replace(/\/+$/, "").toLowerCase();
}

/** Local catalog entry that was downloaded from this server comic, if any. */
export function localCopyOfServerBook(
  serverRecord: WebComicRecord,
  localBooks: WebComicRecord[] | undefined,
  serverUrl: string | null | undefined,
): WebComicRecord | null {
  if (isLocal(serverRecord) || !localBooks?.length) return null;
  const wantServer = normServer(serverUrl);
  const wantId = serverRecord.id;
  for (const b of localBooks) {
    if (!isLocal(b) || !b.origin) continue;
    if (b.origin.comicId !== wantId) continue;
    if (wantServer && normServer(b.origin.server) !== wantServer) continue;
    return b;
  }
  return null;
}

/**
 * Restrained badge for detail / action surfaces (not every cover card).
 */
export function sourceBadge(input: BookContextInput): SourceBadge {
  const { record, offlinePinned, offlineDownloading } = input;

  if (isLocal(record)) {
    if (record.origin) {
      return {
        label: "On this device",
        tone: "local",
        detail: "Saved from your server — readable offline",
      };
    }
    return {
      label: "On this device",
      tone: "local",
      detail: "Imported or saved here — readable offline",
    };
  }

  // Server record
  const saved = localCopyOfServerBook(
    record,
    input.localBooks,
    input.serverUrl,
  );
  if (offlineDownloading) {
    return {
      label: "Downloading",
      tone: "offline",
      detail: saved
        ? "Also saved on this device"
        : "Saving to this device…",
    };
  }
  if (offlinePinned) {
    return {
      label: "Offline",
      tone: "offline",
      detail: saved
        ? "Also on the device shelf"
        : "Available offline",
    };
  }
  if (saved) {
    return {
      label: "On server",
      tone: "server",
      detail: "Also saved on this device",
    };
  }
  return {
    label: "On server",
    tone: "server",
    detail: "Needs the network unless you save it to this device",
  };
}

/** Compact subtitle fragment for reader chrome (single line). */
export function sourceChromeLabel(record: WebComicRecord): string {
  if (isLocal(record)) {
    return record.origin ? "On this device · from server" : "On this device";
  }
  return "On server";
}

/** Whether the action sheet should offer “Save to device”. */
export function canSaveToDevice(
  record: WebComicRecord,
  localBooks: WebComicRecord[] | undefined,
  serverUrl: string | null | undefined,
  localSupported: boolean,
): boolean {
  if (!localSupported || isLocal(record)) return false;
  return localCopyOfServerBook(record, localBooks, serverUrl) == null;
}

/** Whether the action sheet should offer “Remove local copy”. */
export function canRemoveLocalCopy(record: WebComicRecord): boolean {
  return isLocal(record);
}
