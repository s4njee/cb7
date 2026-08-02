/**
 * Vectors for offline progress outbox policy.
 */
import {
  enqueueOutbox,
  getOutboxSnapshot,
  isOfflineProgressError,
  resetOutboxForTests,
  resolveAgainstServer,
  type OutboxEntry,
} from "./progressOutbox";

function entry(partial: Partial<OutboxEntry> & Pick<OutboxEntry, "body">): OutboxEntry {
  return {
    serverUrl: "http://s",
    userId: "u1",
    comicId: 9,
    sessionId: "sess-a",
    updatedAt: 1,
    ...partial,
  };
}

export interface OutboxVector {
  name: string;
  run: () => void;
}

export const OUTBOX_VECTORS: OutboxVector[] = [
  {
    name: "isOfflineProgressError treats status 0 as offline",
    run: () => {
      if (!isOfflineProgressError({ status: 0, message: "Cannot reach server" })) {
        throw new Error("expected offline");
      }
      if (isOfflineProgressError({ status: 400, message: "bad" })) {
        throw new Error("400 is not offline");
      }
    },
  },
  {
    name: "enqueue coalesces to latest body per book",
    run: () => {
      resetOutboxForTests();
      // jsdom-less: localStorage may be missing; polyfill for the vector.
      if (typeof localStorage === "undefined") {
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
      enqueueOutbox("http://s", "u1", 1, { page: 1 }, "s1");
      enqueueOutbox("http://s", "u1", 1, { page: 5 }, "s1");
      const snap = getOutboxSnapshot();
      if (snap.pendingCount !== 1) throw new Error(`count ${snap.pendingCount}`);
      if (snap.entries[0].body.page !== 5) throw new Error("not coalesced");
      resetOutboxForTests();
    },
  },
  {
    name: "same session takes furthest page",
    run: () => {
      const e = entry({ body: { page: 20 }, sessionId: "sess-a" });
      const d = resolveAgainstServer(
        e,
        { lastPage: 10, lastLocation: null, lastPercent: null },
        "sess-a",
      );
      if (d !== "push") throw new Error(d);
    },
  },
  {
    name: "different session large jump is conflict",
    run: () => {
      const e = entry({ body: { page: 50 }, sessionId: "sess-a" });
      const d = resolveAgainstServer(
        e,
        { lastPage: 10, lastLocation: null, lastPercent: null },
        "sess-other",
      );
      if (d !== "conflict") throw new Error(d);
    },
  },
  {
    name: "identical server position drops",
    run: () => {
      const e = entry({ body: { page: 7 }, sessionId: "sess-a" });
      const d = resolveAgainstServer(
        e,
        { lastPage: 7, lastLocation: null, lastPercent: null },
        null,
      );
      if (d !== "drop") throw new Error(d);
    },
  },
];

export function runOutboxVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of OUTBOX_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `progressOutbox: ${OUTBOX_VECTORS.length} ok`
      : `progressOutbox: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
