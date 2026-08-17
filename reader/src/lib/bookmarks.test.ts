/**
 * Vectors for local-first bookmark identity, merge, and key isolation.
 */
import {
  adoptGuestBookmarks,
  createStored,
  hydrateLegacyEpub,
  listVisible,
  localOwnerKey,
  parseServerOwnerKey,
  planBookmarkSync,
  removeStored,
  resetBookmarksForTests,
  sameAnchor,
  serverOwnerKey,
  setStoredNote,
  type RemoteBookmark,
  type StoredBookmark,
} from "./bookmarks";

function ensureLocalStorage(): void {
  if (typeof localStorage !== "undefined") return;
  const store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: () => null,
    length: 0,
  };
}

function local(partial: Partial<StoredBookmark> & Pick<StoredBookmark, "id">): StoredBookmark {
  return {
    page: null,
    location: null,
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    serverId: null,
    deleted: false,
    ...partial,
  };
}

function remote(partial: Partial<RemoteBookmark> & Pick<RemoteBookmark, "id">): RemoteBookmark {
  return {
    page: null,
    location: null,
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

export interface BookmarkVector {
  name: string;
  run: () => void;
}

export const BOOKMARK_VECTORS: BookmarkVector[] = [
  {
    name: "sameAnchor matches page or CFI, never mixes the two",
    run: () => {
      if (!sameAnchor({ page: 3, location: null }, { page: 3, location: null })) {
        throw new Error("pages should match");
      }
      if (sameAnchor({ page: 3, location: null }, { page: 4, location: null })) {
        throw new Error("different pages");
      }
      if (!sameAnchor({ page: null, location: "epubcfi(/6/4)" }, { page: null, location: "epubcfi(/6/4)" })) {
        throw new Error("CFIs should match");
      }
      if (sameAnchor({ page: 3, location: null }, { page: null, location: "epubcfi(/6/4)" })) {
        throw new Error("page vs CFI must not match");
      }
    },
  },
  {
    name: "owner keys isolate local id 5 from server id 5",
    run: () => {
      const local = localOwnerKey(5);
      const server = serverOwnerKey("http://host:8008", "user-1", 5);
      if (local === server) throw new Error("keys collided");
      const parsed = parseServerOwnerKey(server);
      if (!parsed) throw new Error("parse failed");
      if (parsed.serverUrl !== "http://host:8008") throw new Error(parsed.serverUrl);
      if (parsed.actor !== "user-1") throw new Error(parsed.actor);
      if (parsed.bookId !== 5) throw new Error(String(parsed.bookId));
    },
  },
  {
    name: "merge imports a remote-only bookmark",
    run: () => {
      const plan = planBookmarkSync([], [remote({ id: 9, page: 2 })]);
      if (plan.visible.length !== 1) throw new Error(`visible ${plan.visible.length}`);
      if (plan.visible[0].serverId !== 9) throw new Error("not linked");
      if (plan.visible[0].page !== 2) throw new Error("wrong page");
      if (plan.toPush.length || plan.toDelete.length) throw new Error("unexpected ops");
    },
  },
  {
    name: "merge pushes a local-only bookmark",
    run: () => {
      const plan = planBookmarkSync([local({ id: 1, page: 4 })], []);
      if (plan.toPush.length !== 1) throw new Error("not pushed");
      if (plan.toPush[0].id !== 1) throw new Error("wrong local id");
      if (plan.visible.length !== 1) throw new Error("should stay visible");
    },
  },
  {
    name: "merge links a local row to the matching remote page",
    run: () => {
      const plan = planBookmarkSync(
        [local({ id: 1, page: 7 })],
        [remote({ id: 42, page: 7 })],
      );
      if (plan.toPush.length) throw new Error("should link, not push");
      if (plan.visible[0].serverId !== 42) throw new Error("not linked");
      if (plan.visible[0].id !== 1) throw new Error("local id must stay");
    },
  },
  {
    name: "merge tombstone with serverId is a DELETE",
    run: () => {
      const plan = planBookmarkSync(
        [local({ id: 1, page: 2, serverId: 8, deleted: true })],
        [remote({ id: 8, page: 2 })],
      );
      if (plan.toDelete.length !== 1) throw new Error("expected delete");
      if (plan.visible.length) throw new Error("tombstone must stay hidden");
    },
  },
  {
    name: "merge drops a local row the server no longer has",
    run: () => {
      const plan = planBookmarkSync([local({ id: 1, page: 2, serverId: 8 })], []);
      if (plan.visible.length) throw new Error("should drop");
      if (plan.toPush.length || plan.toDelete.length) throw new Error("no ops");
    },
  },
  {
    name: "create is idempotent on the same page",
    run: () => {
      ensureLocalStorage();
      resetBookmarksForTests();
      const key = localOwnerKey(3);
      const a = createStored(key, { page: 1 });
      const b = createStored(key, { page: 1 });
      if (a.id !== b.id) throw new Error("duplicate created");
      if (listVisible(key).length !== 1) throw new Error("two rows");
      resetBookmarksForTests();
    },
  },
  {
    name: "remove of an unsynced row is a hard delete",
    run: () => {
      ensureLocalStorage();
      resetBookmarksForTests();
      const key = localOwnerKey(3);
      const a = createStored(key, { page: 1 });
      removeStored(key, a.id);
      if (listVisible(key).length) throw new Error("still visible");
      resetBookmarksForTests();
    },
  },
  {
    name: "legacy EPUB CFIs hydrate without duplicating",
    run: () => {
      ensureLocalStorage();
      resetBookmarksForTests();
      const key = serverOwnerKey("http://s", "u", 9);
      createStored(key, { location: "epubcfi(/6/2)" });
      const n = hydrateLegacyEpub(key, [
        { cfi: "epubcfi(/6/2)" },
        { cfi: "epubcfi(/6/4)" },
      ]);
      if (n !== 1) throw new Error(`added ${n}`);
      if (listVisible(key).length !== 2) throw new Error("expected two");
      resetBookmarksForTests();
    },
  },
  {
    name: "adoptGuestBookmarks moves leftover guest rows onto the user",
    run: () => {
      ensureLocalStorage();
      resetBookmarksForTests();
      const guest = serverOwnerKey("http://s", "guest", 4);
      createStored(guest, { page: 11 });
      const moved = adoptGuestBookmarks("http://s", "user-1");
      if (moved !== 1) throw new Error(`moved ${moved}`);
      if (listVisible(guest).length) throw new Error("guest key should be gone");
      if (listVisible(serverOwnerKey("http://s", "user-1", 4)).length !== 1) {
        throw new Error("not on user key");
      }
      resetBookmarksForTests();
    },
  },
  {
    name: "setStoredNote writes and returns the updated row",
    run: () => {
      ensureLocalStorage();
      resetBookmarksForTests();
      const key = localOwnerKey(3);
      const a = createStored(key, { page: 1 });
      const updated = setStoredNote(key, a.id, "re-read for the twist");
      if (!updated) throw new Error("no row returned");
      if (updated.note !== "re-read for the twist") throw new Error(updated.note ?? "null");
      if (updated.page !== 1) throw new Error("anchor must not move");
      if (listVisible(key)[0].note !== "re-read for the twist") throw new Error("not persisted");
      resetBookmarksForTests();
    },
  },
  {
    name: "setStoredNote blanks clear the note",
    run: () => {
      ensureLocalStorage();
      resetBookmarksForTests();
      const key = localOwnerKey(3);
      const a = createStored(key, { page: 1, note: "draft note" });
      const updated = setStoredNote(key, a.id, "   ");
      if (!updated || updated.note !== null) throw new Error("blank should clear to null");
      resetBookmarksForTests();
    },
  },
  {
    name: "setStoredNote on an unknown id is a no-op",
    run: () => {
      ensureLocalStorage();
      resetBookmarksForTests();
      const key = localOwnerKey(3);
      createStored(key, { page: 1 });
      if (setStoredNote(key, 999, "nope") !== null) throw new Error("unknown id edited");
      resetBookmarksForTests();
    },
  },
  {
    name: "merge keeps a locally-edited note on a synced row",
    run: () => {
      const plan = planBookmarkSync(
        [local({ id: 1, page: 7, serverId: 42, note: "edited offline" })],
        [remote({ id: 42, page: 7, note: "old server note" })],
      );
      if (plan.visible.length !== 1) throw new Error("row lost");
      if (plan.visible[0].note !== "edited offline") throw new Error("local note clobbered");
      if (plan.toPush.length || plan.toDelete.length) throw new Error("unexpected ops");
    },
  },
];

export function runBookmarkVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of BOOKMARK_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `bookmarks: ${BOOKMARK_VECTORS.length} ok`
      : `bookmarks: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
