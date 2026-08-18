/** Vector module (see `vectorSuite.test.ts`): with several servers saved, no
 *  on-device store may leak state from one library into another.
 *
 *  This is the mitigation the plan's risk table asks for by name — "audit every
 *  persisted key against the bookmark store's existing `server+user` pattern;
 *  add a vector test that switches servers and asserts isolation". Every store
 *  a signed-in reader writes to is exercised here with the *same book id* on
 *  two servers, because a colliding id is exactly how a leak would show up:
 *  comic 7 exists on both libraries and is not the same book.
 */
import {
  createStored,
  listVisible,
  localOwnerKey,
  replaceStored,
  serverOwnerKey,
} from "./bookmarks";
import { allGuestProgress, clearGuestProgress, loadGuestProgress, saveGuestProgress } from "./guestProgress";
import { loadHighlights, loadPdfHighlights, saveHighlights, savePdfHighlights } from "./highlights";
import { clearOutbox, enqueueOutbox, getOutboxSnapshot } from "./progressOutbox";
import {
  forgetLibraryView,
  recallLibraryView,
  rememberLibraryView,
} from "../components/library/viewMemory";

const A = "http://alpha.local:4218";
const B = "http://beta.local:4218";
/** The same id on both servers — a leak would be invisible with distinct ids. */
const BOOK = 7;

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

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function reset(): void {
  ensureLocalStorage();
  clearGuestProgress(A);
  clearGuestProgress(B);
  clearOutbox();
  forgetLibraryView();
  for (const server of [A, B]) {
    saveHighlights(server, BOOK, []);
    savePdfHighlights(server, BOOK, []);
    replaceStored(serverOwnerKey(server, "u1", BOOK), []);
  }
  replaceStored(localOwnerKey(BOOK), []);
}

export interface ServerIsolationVector {
  name: string;
  run: () => void;
}

export const SERVER_ISOLATION_VECTORS: ServerIsolationVector[] = [
  {
    name: "guest progress does not cross servers",
    run: () => {
      reset();
      saveGuestProgress(A, BOOK, { page: 12 });
      assert(loadGuestProgress(A, BOOK)?.page === 12, "server A lost its own progress");
      assert(loadGuestProgress(B, BOOK) === null, "server B saw server A's progress");

      saveGuestProgress(B, BOOK, { page: 300 });
      assert(loadGuestProgress(A, BOOK)?.page === 12, "server A's progress was overwritten");
      assert(Object.keys(allGuestProgress(B)).length === 1, "server B's stash is not its own");
    },
  },
  {
    name: "highlights (EPUB and PDF) do not cross servers",
    run: () => {
      reset();
      saveHighlights(A, BOOK, [
        { cfi: "epubcfi(/6/4!/2)", color: "yellow", text: "on alpha", note: null, createdAt: 1 },
      ]);
      savePdfHighlights(A, BOOK, [
        { id: "a1", page: 3, rects: [], color: "yellow", text: "on alpha", note: null, createdAt: 1 },
      ]);
      assert(loadHighlights(A, BOOK).length === 1, "server A lost its highlight");
      assert(loadHighlights(B, BOOK).length === 0, "server B saw server A's highlights");
      assert(loadPdfHighlights(B, BOOK).length === 0, "server B saw server A's PDF highlights");
    },
  },
  {
    name: "bookmarks are keyed by server and user, and the device shelf is its own",
    run: () => {
      reset();
      createStored(serverOwnerKey(A, "u1", BOOK), { page: 5 });
      createStored(localOwnerKey(BOOK), { page: 99 });

      assert(listVisible(serverOwnerKey(A, "u1", BOOK)).length === 1, "server A lost its bookmark");
      assert(listVisible(serverOwnerKey(B, "u1", BOOK)).length === 0, "server B saw server A's bookmark");
      // Same server, different user: also separate.
      assert(listVisible(serverOwnerKey(A, "u2", BOOK)).length === 0, "another user saw the bookmark");
      // The on-device shelf is never a server's shelf.
      assert(listVisible(localOwnerKey(BOOK))[0]?.page === 99, "the device bookmark was lost");
    },
  },
  {
    name: "queued progress is addressed per server and user",
    run: () => {
      reset();
      enqueueOutbox(A, "u1", BOOK, { page: 12 }, "s1");
      enqueueOutbox(B, "u1", BOOK, { page: 300 }, "s2");
      enqueueOutbox(A, "u2", BOOK, { page: 44 }, "s3");

      const entries = getOutboxSnapshot().entries;
      assert(entries.length === 3, `expected three distinct entries, got ${entries.length}`);
      const onA = entries.filter((e) => e.serverUrl === A);
      assert(onA.length === 2, "server A's entries merged with server B's");
      assert(
        onA.some((e) => e.userId === "u1" && e.body.page === 12),
        "server A / user 1 lost its position",
      );
      assert(
        entries.some((e) => e.serverUrl === B && e.body.page === 300),
        "server B lost its position",
      );
    },
  },
  {
    name: "the remembered shelf view does not follow you to another server",
    run: () => {
      reset();
      rememberLibraryView({
        shelf: "server",
        serverUrl: A,
        scope: { type: "collection", id: 3, name: "Noir" },
        search: "",
        filter: "all",
        readStatus: null,
        favorites: false,
        tag: null,
        collection: null,
        scrollTop: 400,
      });
      assert(recallLibraryView(A) !== null, "server A lost its own view");
      // Collection id 3 means something different on B — never restore it there.
      assert(recallLibraryView(B) === null, "server B restored server A's scope");
    },
  },
];

export function runServerIsolationVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of SERVER_ISOLATION_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `serverIsolation: ${SERVER_ISOLATION_VECTORS.length} ok`
      : `serverIsolation: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
