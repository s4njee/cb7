/**
 * Vectors for source badges and action availability.
 * Typechecked by `pnpm build`; run via tsc + node like the other vector files.
 */
import {
  ACTION_LABELS,
  canRemoveLocalCopy,
  canSaveToDevice,
  localCopyOfServerBook,
  sourceBadge,
  sourceChromeLabel,
} from "./bookContext";
import type { WebComicRecord } from "./api";

function rec(
  partial: Partial<WebComicRecord> & Pick<WebComicRecord, "id" | "title">,
): WebComicRecord {
  return {
    pageCount: 10,
    fileSize: 0,
    dateAdded: "",
    tags: [],
    lastPage: null,
    lastLocation: null,
    lastPercent: null,
    lastRead: null,
    mediaType: "book",
    thumbnailUrl: "",
    fileExt: "epub",
    favorited: false,
    ...partial,
  };
}

export interface CtxVector {
  name: string;
  run: () => void;
}

export const BOOK_CONTEXT_VECTORS: CtxVector[] = [
  {
    name: "action labels never say Delete",
    run: () => {
      const joined = Object.values(ACTION_LABELS).join(" ");
      if (/delete/i.test(joined)) throw new Error(joined);
    },
  },
  {
    name: "local import badge",
    run: () => {
      const b = sourceBadge({ record: rec({ id: 1, title: "A", source: "local" }) });
      if (b.label !== "On this device" || b.tone !== "local") throw new Error(JSON.stringify(b));
    },
  },
  {
    name: "local from-server badge mentions origin",
    run: () => {
      const b = sourceBadge({
        record: rec({
          id: 2,
          title: "B",
          source: "local",
          origin: { server: "http://s", comicId: 9 },
        }),
      });
      if (!b.detail?.toLowerCase().includes("server")) throw new Error(b.detail);
    },
  },
  {
    name: "server badge when also saved",
    run: () => {
      const server = rec({ id: 9, title: "S" });
      const local = rec({
        id: 100,
        title: "S",
        source: "local",
        origin: { server: "http://host:8008", comicId: 9 },
      });
      const b = sourceBadge({
        record: server,
        serverUrl: "http://host:8008",
        localBooks: [local],
      });
      if (b.detail !== "Also saved on this device") throw new Error(JSON.stringify(b));
    },
  },
  {
    name: "localCopyOfServerBook matches origin",
    run: () => {
      const server = rec({ id: 5, title: "X" });
      const local = rec({
        id: 1,
        title: "X",
        source: "local",
        origin: { server: "http://a/", comicId: 5 },
      });
      const hit = localCopyOfServerBook(server, [local], "http://a");
      if (!hit || hit.id !== 1) throw new Error("miss");
    },
  },
  {
    name: "canSaveToDevice false when already local",
    run: () => {
      const server = rec({ id: 3, title: "Y" });
      const local = rec({
        id: 7,
        title: "Y",
        source: "local",
        origin: { server: "http://s", comicId: 3 },
      });
      if (canSaveToDevice(server, [local], "http://s", true)) {
        throw new Error("should not offer save");
      }
    },
  },
  {
    name: "canRemoveLocalCopy only for local",
    run: () => {
      if (!canRemoveLocalCopy(rec({ id: 1, title: "L", source: "local" }))) {
        throw new Error("local should remove");
      }
      if (canRemoveLocalCopy(rec({ id: 2, title: "S" }))) {
        throw new Error("server should not");
      }
    },
  },
  {
    name: "chrome label distinguishes sources",
    run: () => {
      if (sourceChromeLabel(rec({ id: 1, title: "L", source: "local" })) !== "On this device") {
        throw new Error("local chrome");
      }
      if (sourceChromeLabel(rec({ id: 2, title: "S" })) !== "On server") {
        throw new Error("server chrome");
      }
    },
  },
];

export function runBookContextVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of BOOK_CONTEXT_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `bookContext: ${BOOK_CONTEXT_VECTORS.length} ok`
      : `bookContext: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
