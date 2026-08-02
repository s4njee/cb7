/**
 * In-flight “Save to device” / open-time `local_download` progress.
 *
 * LOCAL-FIRST: the full-file download into the on-device library is the one
 * download-to-device path. Offline pins (`download_book`) are legacy. This store
 * is the single place UI reads for a progress bar while a save is running.
 */
import { create } from "zustand";

export interface DeviceTransfer {
  comicId: number;
  title: string;
  received: number;
  total: number | null;
  done: boolean;
  error?: string;
}

interface DeviceTransferState {
  /** Active or recently finished transfers (newest last when iterated). */
  byId: Record<number, DeviceTransfer>;
  /** Mark a transfer as started so the banner has a title before the first event. */
  start: (comicId: number, title: string) => void;
  /** Merge a progress event from `shelf://local-download-progress`. */
  progress: (p: {
    comicId: number;
    received: number;
    total: number | null;
    done: boolean;
  }) => void;
  fail: (comicId: number, error: string) => void;
  clear: (comicId: number) => void;
}

export const useDeviceTransfer = create<DeviceTransferState>((set) => ({
  byId: {},

  start: (comicId, title) =>
    set((s) => ({
      byId: {
        ...s.byId,
        [comicId]: {
          comicId,
          title,
          received: s.byId[comicId]?.received ?? 0,
          total: s.byId[comicId]?.total ?? null,
          done: false,
        },
      },
    })),

  progress: (p) =>
    set((s) => {
      const prev = s.byId[p.comicId];
      return {
        byId: {
          ...s.byId,
          [p.comicId]: {
            comicId: p.comicId,
            title: prev?.title ?? "Book",
            received: p.received,
            total: p.total ?? prev?.total ?? null,
            done: p.done,
          },
        },
      };
    }),

  fail: (comicId, error) =>
    set((s) => {
      const prev = s.byId[comicId];
      if (!prev) return s;
      return {
        byId: {
          ...s.byId,
          [comicId]: { ...prev, done: true, error },
        },
      };
    }),

  clear: (comicId) =>
    set((s) => {
      if (!(comicId in s.byId)) return s;
      const next = { ...s.byId };
      delete next[comicId];
      return { byId: next };
    }),
}));

/** 0–100 when known; null while size is unknown. */
export function transferPercent(t: DeviceTransfer): number | null {
  if (t.done && !t.error) return 100;
  if (t.total != null && t.total > 0) {
    return Math.min(100, Math.round((t.received / t.total) * 100));
  }
  return null;
}

export function activeTransfers(byId: Record<number, DeviceTransfer>): DeviceTransfer[] {
  return Object.values(byId).filter((t) => !t.done || !!t.error);
}

export function formatTransferBytes(received: number, total: number | null): string {
  const fmt = (n: number) => {
    const mb = n / (1024 * 1024);
    if (mb < 0.1) return "< 0.1 MB";
    if (mb < 10) return `${(Math.round(mb * 10) / 10).toFixed(1)} MB`;
    if (mb < 1024) return `${Math.round(mb)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };
  if (total != null && total > 0) return `${fmt(received)} of ${fmt(total)}`;
  return received > 0 ? fmt(received) : "…";
}
