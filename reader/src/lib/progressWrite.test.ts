/**
 * Test vectors for {@link ProgressWriter} — burst collapsing and flush.
 *
 * Same shape as `haptics.test.ts` / `pair.test.ts`: no runner in package.json,
 * typechecked by `pnpm build`, executed manually via tsc + node.
 *
 *     ./node_modules/.bin/tsc src/lib/progressWrite.test.ts --outDir /tmp/pwtest \
 *       --module commonjs --target es2020 --strict --esModuleInterop
 *     node -e "const r = require('/tmp/pwtest/progressWrite.test.js').runProgressWriteVectors(); \
 *       console.log(r.report); process.exit(r.failures.length ? 1 : 0)"
 */
import {
  isMonotonicProgress,
  ProgressWriter,
  resetProgressWriterForTests,
  type ProgressWriteOptions,
} from "./progressWrite";
import type { ProgressBody, WebComicRecord } from "./api";

function fakeRecord(id: number, source: "local" | "server" = "server"): WebComicRecord {
  return {
    id,
    source,
    title: `Book ${id}`,
    pageCount: 100,
    fileSize: 0,
    dateAdded: "",
    tags: [],
    lastPage: null,
    lastLocation: null,
    lastPercent: null,
    lastRead: null,
    mediaType: "comic",
    thumbnailUrl: "",
    fileExt: "cbz",
    favorited: false,
  };
}

interface FakeTimers {
  opts: ProgressWriteOptions;
  flush: () => void;
  advance: (ms: number) => void;
}

/** Drain the full microtask queue. A macrotask hop runs only after every
 *  pending microtask, so an in-flight send's continuation (and the dirty-loop
 *  it triggers) has settled by the time this resolves. */
function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeFakeTimers(): FakeTimers {
  let now = 0;
  type Entry = { at: number; fn: () => void; id: number };
  const queue: Entry[] = [];
  let nextId = 1;

  return {
    opts: {
      now: () => now,
      setTimer: (fn, ms) => {
        const id = nextId++;
        queue.push({ at: now + ms, fn, id });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (id) => {
        const n = id as unknown as number;
        const i = queue.findIndex((e) => e.id === n);
        if (i >= 0) queue.splice(i, 1);
      },
    },
    flush: () => {
      queue.sort((a, b) => a.at - b.at);
      while (queue.length && queue[0].at <= now) {
        const e = queue.shift()!;
        e.fn();
      }
    },
    advance: (ms: number) => {
      now += ms;
      queue.sort((a, b) => a.at - b.at);
      while (queue.length && queue[0].at <= now) {
        const e = queue.shift()!;
        e.fn();
      }
    },
  };
}

export interface ProgressVector {
  name: string;
  run: () => Promise<void> | void;
}

export const PROGRESS_WRITE_VECTORS: ProgressVector[] = [
  {
    name: "isMonotonicProgress accepts first write",
    run: () => {
      if (!isMonotonicProgress(undefined, { page: 3 })) throw new Error("expected true");
    },
  },
  {
    name: "isMonotonicProgress rejects going backwards by page",
    run: () => {
      if (isMonotonicProgress({ page: 5 }, { page: 4 })) throw new Error("expected false");
    },
  },
  {
    name: "isMonotonicProgress rejects going backwards by percent",
    run: () => {
      if (isMonotonicProgress({ percent: 40 }, { percent: 30 })) {
        throw new Error("expected false");
      }
    },
  },
  {
    name: "burst of page turns collapses to one send with the latest page",
    run: async () => {
      const sent: ProgressBody[] = [];
      const timers = makeFakeTimers();
      const w = new ProgressWriter(async (_r, body) => {
        sent.push(body);
      }, { ...timers.opts, delayMs: 800 });

      const rec = fakeRecord(1);
      w.schedule(rec, { page: 1 });
      w.schedule(rec, { page: 2 });
      w.schedule(rec, { page: 3 });
      if (sent.length !== 0) throw new Error(`sent early: ${sent.length}`);
      if (w.pendingCount() !== 1) throw new Error("expected one pending book");

      timers.advance(800);
      await Promise.resolve();
      const pages = sent.map((s) => s.page);
      if (pages.length !== 1 || pages[0] !== 3) {
        throw new Error(`expected one send of page 3, got ${JSON.stringify(sent)}`);
      }
    },
  },
  {
    name: "flush sends immediately without waiting for the timer",
    run: async () => {
      const sent: ProgressBody[] = [];
      const timers = makeFakeTimers();
      const w = new ProgressWriter(async (_r, body) => {
        sent.push(body);
      }, { ...timers.opts, delayMs: 5000 });

      const rec = fakeRecord(2);
      w.schedule(rec, { page: 9 });
      await w.flush(rec);
      if (sent.length !== 1 || sent[0].page !== 9) {
        throw new Error(`expected flush of page 9, got ${JSON.stringify(sent)}`);
      }
      if (w.pendingCount() !== 0) throw new Error("pending should be empty after flush");
    },
  },
  {
    name: "flushAll drains every pending book",
    run: async () => {
      const sent: Array<{ id: number; page?: number }> = [];
      const timers = makeFakeTimers();
      const w = new ProgressWriter(async (r, body) => {
        sent.push({ id: r.id, page: body.page });
      }, { ...timers.opts, delayMs: 5000 });

      w.schedule(fakeRecord(10), { page: 1 });
      w.schedule(fakeRecord(11), { page: 2 });
      await w.flushAll();
      if (sent.length !== 2) throw new Error(`expected 2, got ${sent.length}`);
      const ids = sent.map((s) => s.id).sort((a, b) => a - b);
      if (ids[0] !== 10 || ids[1] !== 11) throw new Error(`ids ${ids}`);
    },
  },
  {
    name: "backward schedule is dropped while a newer value is pending",
    run: async () => {
      const sent: ProgressBody[] = [];
      const timers = makeFakeTimers();
      const w = new ProgressWriter(async (_r, body) => {
        sent.push(body);
      }, { ...timers.opts, delayMs: 100 });

      const rec = fakeRecord(3);
      w.schedule(rec, { page: 10 });
      w.schedule(rec, { page: 8 }); // back, but page 10 is still pending
      timers.advance(100);
      await Promise.resolve();
      if (sent.length !== 1 || sent[0].page !== 10) {
        throw new Error(`expected only page 10, got ${JSON.stringify(sent)}`);
      }
    },
  },
  {
    name: "backward schedule after the forward value has flushed is accepted",
    run: async () => {
      const sent: ProgressBody[] = [];
      const timers = makeFakeTimers();
      const w = new ProgressWriter(async (_r, body) => {
        sent.push(body);
      }, { ...timers.opts, delayMs: 100 });

      const rec = fakeRecord(3);
      w.schedule(rec, { page: 10 });
      timers.advance(100);
      await drain(); // page 10 flushed and its in-flight send settled
      w.schedule(rec, { page: 8 }); // back, nothing pending anymore
      timers.advance(100);
      await drain();
      if (sent.length !== 2 || sent[0].page !== 10 || sent[1].page !== 8) {
        throw new Error(`expected page 10 then page 8, got ${JSON.stringify(sent)}`);
      }
    },
  },
  {
    name: "slow in-flight send serializes a newer schedule to land last",
    run: async () => {
      const sent: ProgressBody[] = [];
      const releases: Array<() => void> = [];
      const timers = makeFakeTimers();
      const w = new ProgressWriter(async (_r, body) => {
        await new Promise<void>((resolve) => releases.push(resolve));
        sent.push(body);
      }, { ...timers.opts, delayMs: 100 });

      const rec = fakeRecord(4);
      w.schedule(rec, { page: 5 });
      timers.advance(100); // timer fires → send of page 5 is now in flight
      w.schedule(rec, { page: 6 }); // newer schedule while page 5 is in flight
      timers.advance(100); // timer fires → flushKey marks the key dirty
      releases[0](); // first send completes
      await drain();
      // Dirty loop picked up page 6 and started its send after page 5.
      releases[1]();
      await drain();
      if (sent.length !== 2 || sent[0].page !== 5 || sent[1].page !== 6) {
        throw new Error(`expected page 5 then page 6, got ${JSON.stringify(sent)}`);
      }
    },
  },
  {
    name: "local and server books with the same numeric id do not collide",
    run: async () => {
      const sent: Array<{ source?: string; page?: number }> = [];
      const timers = makeFakeTimers();
      const w = new ProgressWriter(async (r, body) => {
        sent.push({ source: r.source, page: body.page });
      }, { ...timers.opts, delayMs: 50 });

      w.schedule(fakeRecord(5, "local"), { page: 1 });
      w.schedule(fakeRecord(5, "server"), { page: 2 });
      timers.advance(50);
      await Promise.resolve();
      if (sent.length !== 2) throw new Error(`expected 2 sends, got ${sent.length}`);
    },
  },
];

export function runProgressWriteVectors(): {
  failures: string[];
  report: string;
} {
  resetProgressWriterForTests();
  const failures: string[] = [];
  const run = async () => {
    for (const v of PROGRESS_WRITE_VECTORS) {
      try {
        await v.run();
      } catch (err) {
        failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  // Synchronous entry for the node -e runner: block with a deasync-free spin
  // by returning a Promise-shaped result only when awaited; for the common
  // sync runner we stash a thenable and the docs say to await via top-level
  // async IIFE. Export both.
  let done = false;
  const p = run().then(() => {
    done = true;
  });
  // Busy-wait is unacceptable; the package's manual runners use async. Expose
  // a sync-looking API that only works when vectors are sync — ours are async
  // so the node -e snippet must use the async export below.
  void p;
  void done;
  return {
    failures: ["use runProgressWriteVectorsAsync"],
    report: "use runProgressWriteVectorsAsync()",
  };
}

export async function runProgressWriteVectorsAsync(): Promise<{
  failures: string[];
  report: string;
}> {
  resetProgressWriterForTests();
  const failures: string[] = [];
  for (const v of PROGRESS_WRITE_VECTORS) {
    try {
      await v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `progressWrite: ${PROGRESS_WRITE_VECTORS.length} ok`
      : `progressWrite: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
