/**
 * Debounced reading-progress writes.
 *
 * All three readers used to call {@link putProgress} on every page turn or EPUB
 * relocation. Local progress rewrites `catalog.json` on each call, and server
 * books fire a PUT every turn. A trailing debounce collapses bursts while an
 * explicit flush on unmount / background / pagehide keeps the final position.
 *
 * A value is only dropped while a newer one is still pending (armed, not yet
 * flushed) for the same book key; once flushed, a backward navigation (scrub
 * back) is accepted and eventually saved. Sends are serialized per book key so
 * the server always ends with the last-scheduled position.
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
  /** Per-key in-flight send, so a slow send can never be overtaken by a newer one. */
  private inFlight = new Map<string, Promise<void>>();
  /** Keys whose pending body must be sent once the in-flight send finishes. */
  private dirty = new Set<string>();
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
   * Queue a progress write. Coalesces to the latest body for the book. A value
   * is dropped only while a NEWER one is still pending (armed, not yet flushed)
   * for the same book — a backward scrub after the forward value has flushed is
   * accepted and eventually saved.
   */
  schedule(record: WebComicRecord, body: ProgressBody): void {
    const key = bookKey(record);
    const prev = this.pending.get(key)?.body;
    if (!isMonotonicProgress(prev, body)) return;

    this.pending.set(key, { record, body });

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

    // A send for this key is already in flight — mark it dirty so the running
    // loop picks up the latest pending body, and await it instead of starting a
    // second concurrent send (completion order must equal schedule order).
    const inFlight = this.inFlight.get(key);
    if (inFlight) {
      this.dirty.add(key);
      await inFlight;
      return;
    }

    this.pending.delete(key);
    await this.sendPending(key, entry);
    // Keep sending while newer bodies arrived during the in-flight send, so the
    // server always ends with the last-scheduled position.
    while (this.dirty.delete(key)) {
      const latest = this.pending.get(key);
      if (!latest) break;
      this.pending.delete(key);
      await this.sendPending(key, latest);
    }
  }

  /** Send one body, recording the in-flight promise so concurrent flushes for
   *  the same key serialize onto it rather than racing it. */
  private async sendPending(key: string, pending: Pending): Promise<void> {
    const promise = this.send(pending.record, pending.body).then(
      () => undefined,
      () => {
        // Same silent-fail contract as fire-and-forget putProgress; the outbox
        // (when enabled) records offline failures inside the sender.
      },
    );
    this.inFlight.set(key, promise);
    try {
      await promise;
    } finally {
      this.inFlight.delete(key);
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
