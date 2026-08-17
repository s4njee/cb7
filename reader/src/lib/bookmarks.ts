/**
 * Local-first bookmarks for every format.
 *
 * The device store is the source of truth. A bookmark is a page index (comics /
 * PDFs) or a CFI (EPUB). Server copies are linked opportunistically — the same
 * shape as the progress outbox — so standalone, guest, and offline reading all
 * keep the ribbon working. Connecting a signed-in session merges and pushes.
 *
 * Keys isolate sources: local book id 5 and server book id 5 never collide.
 */

export interface StoredBookmark {
  id: number;
  page: number | null;
  location: string | null;
  note: string | null;
  createdAt: string;
  /** Server-assigned id once this row has been POSTed (or imported). */
  serverId?: number | null;
  /** Tombstone: hidden locally, DELETE pending if `serverId` is set. */
  deleted?: boolean;
}

export interface RemoteBookmark {
  id: number;
  page: number | null;
  location: string | null;
  note: string | null;
  createdAt: string;
}

export interface BookmarkSyncPlan {
  /** What the UI should show (no tombstones). */
  visible: StoredBookmark[];
  /** Next on-device list, including remaining tombstones. */
  next: StoredBookmark[];
  /** Local rows that still need a POST. */
  toPush: StoredBookmark[];
  /** Tombstones that still need a DELETE. */
  toDelete: StoredBookmark[];
}

const STORE_KEY = "shelf.bookmarks.v2";
const LEGACY_LOCAL_KEY = "shelf.local.bookmarks";

type Store = Record<string, StoredBookmark[]>;

let memory: Store | null = null;

function readStore(): Store {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    memory = raw ? (JSON.parse(raw) as Store) : {};
    if (!memory || typeof memory !== "object") memory = {};
  } catch {
    memory = {};
  }
  migrateLegacyLocalMap(memory);
  return memory;
}

function writeStore(store: Store): void {
  memory = store;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage full — keep in-memory so this session still works */
  }
}

/** Lift the v1 `shelf.local.bookmarks` map (`{ "3": [...] }`) into v2 keys. */
function migrateLegacyLocalMap(store: Store): void {
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, StoredBookmark[]>;
    if (!parsed || typeof parsed !== "object") {
      localStorage.removeItem(LEGACY_LOCAL_KEY);
      return;
    }
    for (const [id, list] of Object.entries(parsed)) {
      if (!/^\d+$/.test(id) || !Array.isArray(list)) continue;
      const key = localOwnerKey(Number(id));
      if (!store[key]?.length) store[key] = list.map(normalizeStored);
    }
    localStorage.removeItem(LEGACY_LOCAL_KEY);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      /* in-memory is enough */
    }
  } catch {
    /* leave the old key; next open retries */
  }
}

function normalizeStored(b: StoredBookmark): StoredBookmark {
  return {
    id: Number(b.id) || 0,
    page: b.page ?? null,
    location: b.location ?? null,
    note: b.note ?? null,
    createdAt: b.createdAt || new Date().toISOString(),
    serverId: b.serverId ?? null,
    deleted: !!b.deleted,
  };
}

export function localOwnerKey(bookId: number): string {
  return `l:${bookId}`;
}

export function serverOwnerKey(serverUrl: string, actor: string, bookId: number): string {
  return `s:${encodeURIComponent(serverUrl)}:${actor}:${bookId}`;
}

export function parseServerOwnerKey(
  key: string,
): { serverUrl: string; actor: string; bookId: number } | null {
  if (!key.startsWith("s:")) return null;
  const rest = key.slice(2);
  const first = rest.indexOf(":");
  const last = rest.lastIndexOf(":");
  if (first < 0 || last <= first) return null;
  const serverUrl = decodeURIComponent(rest.slice(0, first));
  const actor = rest.slice(first + 1, last);
  const bookId = Number(rest.slice(last + 1));
  if (!serverUrl || !actor || !Number.isFinite(bookId)) return null;
  return { serverUrl, actor, bookId };
}

/** Same comic page, or the same EPUB CFI — the identity of a bookmark. */
export function sameAnchor(
  a: { page: number | null; location: string | null },
  b: { page: number | null; location: string | null },
): boolean {
  if (a.page != null && b.page != null) return a.page === b.page;
  if (a.location && b.location) return a.location === b.location;
  return false;
}

function nextId(list: StoredBookmark[]): number {
  return list.reduce((max, b) => Math.max(max, b.id), 0) + 1;
}

export function listStored(ownerKey: string): StoredBookmark[] {
  return (readStore()[ownerKey] ?? []).map(normalizeStored);
}

export function listVisible(ownerKey: string): StoredBookmark[] {
  return listStored(ownerKey).filter((b) => !b.deleted);
}

export function createStored(
  ownerKey: string,
  body: { page?: number; location?: string; note?: string },
): StoredBookmark {
  const store = { ...readStore() };
  const list = (store[ownerKey] ?? []).map(normalizeStored);
  const page = body.page ?? null;
  const location = body.location ?? null;
  const existing = list.find((b) => !b.deleted && sameAnchor(b, { page, location }));
  if (existing) return existing;
  const bookmark: StoredBookmark = {
    id: nextId(list),
    page,
    location,
    note: body.note ?? null,
    createdAt: new Date().toISOString(),
    serverId: null,
    deleted: false,
  };
  store[ownerKey] = [...list, bookmark];
  writeStore(store);
  return bookmark;
}

/** Hard-delete a never-synced row; tombstone one that has a server id. */
export function removeStored(ownerKey: string, bookmarkId: number): void {
  const store = { ...readStore() };
  const list = (store[ownerKey] ?? []).map(normalizeStored);
  const next: StoredBookmark[] = [];
  for (const b of list) {
    if (b.id !== bookmarkId) {
      next.push(b);
      continue;
    }
    if (b.serverId != null) {
      next.push({ ...b, deleted: true });
    }
  }
  if (next.length) store[ownerKey] = next;
  else delete store[ownerKey];
  writeStore(store);
}

export function setServerId(ownerKey: string, localId: number, serverId: number): void {
  const store = { ...readStore() };
  const list = (store[ownerKey] ?? []).map(normalizeStored);
  store[ownerKey] = list.map((b) => (b.id === localId ? { ...b, serverId } : b));
  writeStore(store);
}

/** Set or clear a bookmark's note. Returns the updated row, or null if the id
 *  doesn't exist. A blank note clears; the anchor is never touched. */
export function setStoredNote(
  ownerKey: string,
  bookmarkId: number,
  note: string | null,
): StoredBookmark | null {
  const store = { ...readStore() };
  const list = (store[ownerKey] ?? []).map(normalizeStored);
  const cleaned = note?.trim() ? note : null;
  let updated: StoredBookmark | null = null;
  const next = list.map((b) => {
    if (b.id !== bookmarkId || b.deleted) return b;
    updated = { ...b, note: cleaned };
    return updated;
  });
  if (!updated) return null;
  store[ownerKey] = next;
  writeStore(store);
  return updated;
}

export function purgeStored(ownerKey: string, localId: number): void {
  const store = { ...readStore() };
  const list = (store[ownerKey] ?? []).map(normalizeStored).filter((b) => b.id !== localId);
  if (list.length) store[ownerKey] = list;
  else delete store[ownerKey];
  writeStore(store);
}

export function replaceStored(ownerKey: string, list: StoredBookmark[]): void {
  const store = { ...readStore() };
  if (list.length) store[ownerKey] = list.map(normalizeStored);
  else delete store[ownerKey];
  writeStore(store);
}

/** Drop every bookmark for a local book (the file was removed). */
export function forgetLocalBookmarks(bookId: number): void {
  const store = { ...readStore() };
  delete store[localOwnerKey(bookId)];
  writeStore(store);
}

/**
 * Decide how the on-device list and a freshly fetched server list should meet.
 * Pure: does not touch storage.
 */
export function planBookmarkSync(
  local: StoredBookmark[],
  remote: RemoteBookmark[],
): BookmarkSyncPlan {
  const unused = new Set(remote.map((r) => r.id));
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const toPush: StoredBookmark[] = [];
  const toDelete: StoredBookmark[] = [];
  const next: StoredBookmark[] = [];

  for (const row of local.map(normalizeStored)) {
    if (row.deleted) {
      if (row.serverId != null && remoteById.has(row.serverId)) {
        unused.delete(row.serverId);
        toDelete.push(row);
        next.push(row);
      }
      // else: server already gone, or never synced — drop the tombstone
      continue;
    }
    if (row.serverId != null) {
      if (remoteById.has(row.serverId)) {
        unused.delete(row.serverId);
        next.push(row);
      }
      // Deleted on another device — drop the local copy.
      continue;
    }
    const match = remote.find((r) => unused.has(r.id) && sameAnchor(row, r));
    if (match) {
      unused.delete(match.id);
      next.push({ ...row, serverId: match.id });
    } else {
      toPush.push(row);
      next.push(row);
    }
  }

  for (const r of remote) {
    if (!unused.has(r.id)) continue;
    next.push({
      id: nextId(next),
      page: r.page,
      location: r.location,
      note: r.note,
      createdAt: r.createdAt,
      serverId: r.id,
      deleted: false,
    });
  }

  return {
    visible: next.filter((b) => !b.deleted),
    next,
    toPush,
    toDelete,
  };
}

/** Fold leftover guest bookmarks into the signed-in user's lists (additive). */
export function adoptGuestBookmarks(serverUrl: string, userId: string): number {
  if (!serverUrl || !userId) return 0;
  const store = { ...readStore() };
  let moved = 0;
  for (const [key, list] of Object.entries(store)) {
    const parsed = parseServerOwnerKey(key);
    if (!parsed || parsed.serverUrl !== serverUrl || parsed.actor !== "guest") continue;
    const dest = serverOwnerKey(serverUrl, userId, parsed.bookId);
    const existing = (store[dest] ?? []).map(normalizeStored);
    for (const row of list.map(normalizeStored)) {
      if (row.deleted) continue;
      if (existing.some((b) => !b.deleted && sameAnchor(b, row))) continue;
      existing.push({
        ...row,
        id: nextId(existing),
        serverId: null,
        deleted: false,
      });
      moved++;
    }
    store[dest] = existing;
    delete store[key];
  }
  writeStore(store);
  return moved;
}

export function pendingServerKeys(serverUrl: string, actor: string): string[] {
  const prefix = `s:${encodeURIComponent(serverUrl)}:${actor}:`;
  return Object.keys(readStore()).filter((k) => k.startsWith(prefix));
}

/** Import pre-server EPUB CFIs (`shelf.bookmarks.<server>.<id>`) into the store. */
export function hydrateLegacyEpub(
  ownerKey: string,
  entries: Array<{ cfi: string; createdAt?: number }>,
): number {
  if (!entries.length) return 0;
  const store = { ...readStore() };
  const list = (store[ownerKey] ?? []).map(normalizeStored);
  let added = 0;
  for (const e of entries) {
    if (!e.cfi) continue;
    if (list.some((b) => !b.deleted && b.location === e.cfi)) continue;
    list.push({
      id: nextId(list),
      page: null,
      location: e.cfi,
      note: null,
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : new Date().toISOString(),
      serverId: null,
      deleted: false,
    });
    added++;
  }
  if (added) {
    store[ownerKey] = list;
    writeStore(store);
  }
  return added;
}

export function publicBookmark(b: StoredBookmark): {
  id: number;
  page: number | null;
  location: string | null;
  note: string | null;
  createdAt: string;
} {
  return {
    id: b.id,
    page: b.page,
    location: b.location,
    note: b.note,
    createdAt: b.createdAt,
  };
}

/** Reset in-memory + disk state (tests). */
export function resetBookmarksForTests(): void {
  memory = null;
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(LEGACY_LOCAL_KEY);
  } catch {
    /* ignore */
  }
}
