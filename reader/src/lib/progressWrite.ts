/**
 * Debounced reading-progress writes.
 *
 * All three readers used to call {@link putProgress} on every page turn or EPUB
 * relocation. Local progress rewrites `catalog.json` on each call, and server
 * books fire a PUT every turn. A trailing debounce collapses bursts while an
 * explicit flush on unmount / background / pagehide keeps the final position.
 *
 * Monotonic within one session: a later page/percent never yields to an earlier
 * one that was still pending for the same book key.
 */

import type { ProgressBody, WebComicRecord } from "./api";

export type ProgressSender = (
  record: WebComicRecord,
  body: ProgressBody,
) => Promise<unknown>;

export interface ProgressWriteOptions {
  /** Trailing debounce in ms. Default 800. */
  delayMs?: number;
  /** Injected clock for tests. */
  now?: () => number;
  /** Injected timer for tests. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}

interface Pending {
  record: WebComicRecord;
  body: ProgressBody;
  /** Session-local sequence so older debounced values cannot overwrite newer. */
  seq: number;
}

const DEFAULT_DELAY = 800;

function bookKey(record: WebComicRecord): string {
  return `${record.source ?? "server"}:${record.id}`;
}

/** True when `next` is at least as far as `prev` for the same book. */
export function isMonotonicProgress(
  prev: ProgressBody | undefined,
  next: ProgressBody,
): boolean {
  if (!prev) return true;
  if (next.page != null && prev.page != null && next.page < prev.page) return false;
  if (next.percent != null && prev.percent != null && next.percent < prev.percent) {
    return false;
  }
  // Location-only CFIs are not ordered; accept the latest write.
  return true;
}

/**
 * One scheduler per app. Callers schedule; the scheduler owns the timer map
 * and the latest body per book.
 */
export class ProgressWriter {
  private readonly delayMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (id: ReturnType<typeof setTimeout>) => void;
  private readonly send: ProgressSender;

  private pending = new Map<string, Pending>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastSent = new Map<string, ProgressBody>();
  private seq = 0;
  private unsubVisibility: (() => void) | null = null;
  private unsubPageHide: (() => void) | null = null;

  constructor(send: ProgressSender, opts: ProgressWriteOptions = {}) {
    this.send = send;
    this.delayMs = opts.delayMs ?? DEFAULT_DELAY;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  /** Wire document lifecycle so backgrounding flushes pending positions. */
  attachLifecycle(): () => void {
    if (typeof document === "undefined") return () => {};

    const onVis = () => {
      if (document.visibilityState === "hidden") void this.flushAll();
    };
    const onHide = () => {
      void this.flushAll();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    this.unsubVisibility = () => document.removeEventListener("visibilitychange", onVis);
    this.unsubPageHide = () => window.removeEventListener("pagehide", onHide);
    return () => this.detachLifecycle();
  }

  detachLifecycle(): void {
    this.unsubVisibility?.();
    this.unsubPageHide?.();
    this.unsubVisibility = null;
    this.unsubPageHide = null;
  }

  /**
   * Queue a progress write. Coalesces to the latest body for the book; drops
   * values that would go backwards within the session.
   */
  schedule(record: WebComicRecord, body: ProgressBody): void {
    const key = bookKey(record);
    const prev = this.pending.get(key)?.body ?? this.lastSent.get(key);
    if (!isMonotonicProgress(prev, body)) return;

    const seq = ++this.seq;
    this.pending.set(key, { record, body, seq });

    const existing = this.timers.get(key);
    if (existing != null) this.clearTimer(existing);

    const id = this.setTimer(() => {
      this.timers.delete(key);
      void this.flushKey(key);
    }, this.delayMs);
    this.timers.set(key, id);
  }

  /** Flush one book immediately (reader unmount). */
  async flush(record: WebComicRecord): Promise<void> {
    await this.flushKey(bookKey(record));
  }

  /** Flush every pending book (background / unload). */
  async flushAll(): Promise<void> {
    const keys = [...this.pending.keys()];
    await Promise.all(keys.map((k) => this.flushKey(k)));
  }

  /** Test helper: how many books have an unsent body. */
  pendingCount(): number {
    return this.pending.size;
  }

  private async flushKey(key: string): Promise<void> {
    const timer = this.timers.get(key);
    if (timer != null) {
      this.clearTimer(timer);
      this.timers.delete(key);
    }
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    try {
      await this.send(entry.record, entry.body);
      this.lastSent.set(key, entry.body);
    } catch {
      // Same silent-fail contract as fire-and-forget putProgress; the outbox
      // (when enabled) records offline failures inside the sender.
    }
  }
}

/** Shared app-wide writer. Lazily built so tests can construct their own. */
let shared: ProgressWriter | null = null;

export function getProgressWriter(send: ProgressSender): ProgressWriter {
  if (!shared) {
    shared = new ProgressWriter(send);
    shared.attachLifecycle();
  }
  return shared;
}

/** Reset the singleton (tests only). */
export function resetProgressWriterForTests(): void {
  shared?.detachLifecycle();
  shared = null;
}
