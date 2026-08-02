/**
 * Offline progress outbox for server books.
 *
 * When a progress PUT fails because the device is offline (or the transport
 * cannot reach the server), the latest position per server/user/book is kept
 * on-device and retried after connectivity returns. Intermediate turns are
 * coalesced — only the newest body is stored.
 *
 * Conflict policy (client-side, no server session field yet):
 * - Same reading session id → push the furthest position without asking.
 * - Different session / unknown → surface a conflict for the UI to resolve
 *   rather than silently overwriting another device.
 */

import type { ProgressBody } from "./api";
import { isOfflineError } from "./loadState";
import type { ApiError } from "./transport";

export type OutboxStatus = "idle" | "pending" | "syncing" | "conflict" | "error";

export interface OutboxEntry {
  serverUrl: string;
  userId: string;
  comicId: number;
  body: ProgressBody;
  /** Client reading-session id that produced this position. */
  sessionId: string;
  /** Epoch ms of the last local update. */
  updatedAt: number;
  /** Set when a server position disagrees and needs a user choice. */
  conflict?: {
    serverPage?: number | null;
    serverLocation?: string | null;
    serverPercent?: number | null;
  };
}

export interface OutboxSnapshot {
  status: OutboxStatus;
  pendingCount: number;
  entries: OutboxEntry[];
  lastError: string | null;
}

type Store = Record<string, OutboxEntry>;

const STORAGE_KEY = "shelf.progressOutbox.v1";

type Listener = (snap: OutboxSnapshot) => void;

let memory: Store | null = null;
let status: OutboxStatus = "idle";
let lastError: string | null = null;
const listeners = new Set<Listener>();

function entryKey(serverUrl: string, userId: string, comicId: number): string {
  return `${serverUrl}\0${userId}\0${comicId}`;
}

function readStore(): Store {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    memory = raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    memory = {};
  }
  return memory!;
}

function writeStore(store: Store): void {
  memory = store;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage full — keep in-memory only */
  }
  emit();
}

function emit(): void {
  const snap = getOutboxSnapshot();
  for (const l of listeners) l(snap);
}

export function getOutboxSnapshot(): OutboxSnapshot {
  const entries = Object.values(readStore());
  const pendingCount = entries.length;
  let s = status;
  if (entries.some((e) => e.conflict)) s = "conflict";
  else if (pendingCount > 0 && s === "idle") s = "pending";
  return { status: s, pendingCount, entries, lastError };
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  listener(getOutboxSnapshot());
  return () => listeners.delete(listener);
}

/** Coalesce: keep only the latest body for this book. */
export function enqueueOutbox(
  serverUrl: string,
  userId: string,
  comicId: number,
  body: ProgressBody,
  sessionId: string,
): void {
  if (!serverUrl || !userId) return;
  const store = { ...readStore() };
  const key = entryKey(serverUrl, userId, comicId);
  const prev = store[key];
  store[key] = {
    serverUrl,
    userId,
    comicId,
    body: { ...prev?.body, ...body },
    sessionId,
    updatedAt: Date.now(),
    // A fresh local write clears a previous conflict until flush re-checks.
    conflict: undefined,
  };
  status = "pending";
  lastError = null;
  writeStore(store);
}

export function removeOutboxEntry(
  serverUrl: string,
  userId: string,
  comicId: number,
): void {
  const store = { ...readStore() };
  delete store[entryKey(serverUrl, userId, comicId)];
  if (Object.keys(store).length === 0) status = "idle";
  writeStore(store);
}

export function clearOutbox(): void {
  status = "idle";
  lastError = null;
  writeStore({});
}

/** Transport errors that mean "try later", not "bad request". */
export function isOfflineProgressError(err: unknown): boolean {
  return isOfflineError(err);
}

/**
 * Compare local outbox vs server record. Same session → take furthest.
 * Different progress from another device → conflict.
 */
export function resolveAgainstServer(
  entry: OutboxEntry,
  server: {
    lastPage: number | null;
    lastLocation: string | null;
    lastPercent: number | null;
  },
  /** Session id currently open for this book, if any. */
  openSessionId: string | null,
): "push" | "drop" | "conflict" {
  const localPage = entry.body.page;
  const serverPage = server.lastPage;
  const localPct = entry.body.percent;
  const serverPct = server.lastPercent;

  const sameSession = openSessionId != null && entry.sessionId === openSessionId;

  // No server position → safe to push.
  if (serverPage == null && server.lastLocation == null && serverPct == null) {
    return "push";
  }

  // Page-based books.
  if (localPage != null && serverPage != null) {
    if (localPage === serverPage) return "drop";
    if (sameSession) return localPage >= serverPage ? "push" : "drop";
    // Different session: furthest only when clearly ahead on the same axis;
    // otherwise ask (another device may have jumped via TOC).
    if (localPage > serverPage && localPage - serverPage <= 2) return "push";
    return "conflict";
  }

  // Percent-based (EPUB).
  if (localPct != null && serverPct != null) {
    if (Math.abs(localPct - serverPct) < 0.5) return "drop";
    if (sameSession) return localPct >= serverPct ? "push" : "drop";
    if (localPct > serverPct && localPct - serverPct <= 2) return "push";
    return "conflict";
  }

  // Location-only: cannot order CFIs → conflict unless same session.
  if (entry.body.location && server.lastLocation) {
    if (entry.body.location === server.lastLocation) return "drop";
    if (sameSession) return "push";
    return "conflict";
  }

  return "push";
}

export type PutProgressFn = (comicId: number, body: ProgressBody) => Promise<unknown>;
export type FetchRecordFn = (comicId: number) => Promise<{
  lastPage: number | null;
  lastLocation: string | null;
  lastPercent: number | null;
}>;

export interface FlushOptions {
  put: PutProgressFn;
  fetchRecord: FetchRecordFn;
  /** Open reading-session id per comic id (from stats / reader). */
  openSessions?: Map<number, string>;
  /** Only flush entries for this server (optional filter). */
  serverUrl?: string | null;
  userId?: string | null;
}

/**
 * Attempt to send every pending entry. Coalesced bodies only; conflicts are
 * marked on the entry and left for the UI.
 */
export async function flushOutbox(opts: FlushOptions): Promise<OutboxSnapshot> {
  const store = { ...readStore() };
  const entries = Object.values(store).filter((e) => {
    if (opts.serverUrl && e.serverUrl !== opts.serverUrl) return false;
    if (opts.userId && e.userId !== opts.userId) return false;
    return true;
  });
  if (entries.length === 0) {
    status = "idle";
    emit();
    return getOutboxSnapshot();
  }

  status = "syncing";
  lastError = null;
  emit();

  for (const entry of entries) {
    const key = entryKey(entry.serverUrl, entry.userId, entry.comicId);
    try {
      const server = await opts.fetchRecord(entry.comicId);
      const openId = opts.openSessions?.get(entry.comicId) ?? null;
      const decision = resolveAgainstServer(entry, server, openId);
      if (decision === "drop") {
        delete store[key];
        continue;
      }
      if (decision === "conflict") {
        store[key] = {
          ...entry,
          conflict: {
            serverPage: server.lastPage,
            serverLocation: server.lastLocation,
            serverPercent: server.lastPercent,
          },
        };
        continue;
      }
      await opts.put(entry.comicId, entry.body);
      delete store[key];
    } catch (err) {
      if (isOfflineProgressError(err)) {
        lastError = (err as ApiError).message ?? "offline";
        // leave entry; try later
        break;
      }
      lastError = (err as ApiError)?.message ?? String(err);
      // Permanent failure for this entry — keep for retry / inspection
    }
  }

  writeStore(store);
  const remaining = Object.keys(readStore()).length;
  status = remaining === 0 ? "idle" : Object.values(readStore()).some((e) => e.conflict)
    ? "conflict"
    : "pending";
  emit();
  return getOutboxSnapshot();
}

/** User chose "keep my position" on a conflict. */
export async function resolveConflictPush(
  entry: OutboxEntry,
  put: PutProgressFn,
): Promise<void> {
  await put(entry.comicId, entry.body);
  removeOutboxEntry(entry.serverUrl, entry.userId, entry.comicId);
}

/** User chose "keep server position". */
export function resolveConflictDrop(entry: OutboxEntry): void {
  removeOutboxEntry(entry.serverUrl, entry.userId, entry.comicId);
}

/** Reset in-memory state (tests). */
export function resetOutboxForTests(): void {
  memory = null;
  status = "idle";
  lastError = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
