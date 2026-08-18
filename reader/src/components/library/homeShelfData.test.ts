/** Vector module (see `lib/vectorSuite.test.ts`): which home rows appear, in
 *  what order, and what lands in each. Pure — the rows are built from records,
 *  not from a rendered screen. */
import { buildHomeShelves, localHomeSources } from "./homeShelfData";
import type { WebComicRecord } from "../../lib/api";

function rec(
  id: number,
  title: string,
  extra: Partial<WebComicRecord> = {},
): WebComicRecord {
  return {
    id,
    title,
    mediaType: "book",
    pageCount: 100,
    dateAdded: "2026-01-01",
    lastRead: null,
    lastPage: null,
    lastPercent: null,
    favorited: false,
    ...extra,
  } as unknown as WebComicRecord;
}

const READING = rec(1, "Cannery Row", { lastPercent: 40, lastRead: "2026-08-10" });
const OLDER_READING = rec(2, "Catch-22", { lastPercent: 10, lastRead: "2026-08-01" });
const FINISHED = rec(3, "Saga v01", { lastPercent: 100, lastRead: "2026-08-09" });
const SEQUEL = rec(4, "Saga v02", { dateAdded: "2026-08-05" });
const FRESH = rec(5, "Just Arrived", { dateAdded: "2026-08-17" });
const LOVED = rec(6, "A Favourite", { favorited: true });

const SHELF = [READING, OLDER_READING, FINISHED, SEQUEL, FRESH, LOVED];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function shelfFor(records: WebComicRecord[]) {
  const rows = buildHomeShelves(localHomeSources(records));
  return {
    keys: rows.map((r) => r.key),
    row: (key: string) => rows.find((r) => r.key === key),
  };
}

export interface HomeShelfVector {
  name: string;
  run: () => void;
}

export const HOME_SHELF_VECTORS: HomeShelfVector[] = [
  {
    name: "an empty shelf shows no rows at all",
    run: () => {
      assert(buildHomeShelves(localHomeSources([])).length === 0, "empty shelf produced rows");
    },
  },
  {
    name: "rows that would be empty do not appear",
    run: () => {
      // Nothing started, nothing finished, nothing favorited: only "Recently
      // added" can answer, so it is the only row.
      const { keys } = shelfFor([rec(9, "Bare Book")]);
      assert(keys.join(",") === "recent", `expected only recent, got ${keys.join(",")}`);
    },
  },
  {
    name: "continue reading holds unfinished books, most recent first",
    run: () => {
      const row = shelfFor(SHELF).row("continue");
      assert(!!row, "expected a continue row");
      assert(
        row!.records.map((r) => r.id).join(",") === "1,2",
        `unexpected order: ${row!.records.map((r) => r.id).join(",")}`,
      );
      // A finished book is not something you are part-way through.
      assert(!row!.records.some((r) => r.id === FINISHED.id), "a finished book leaked in");
    },
  },
  {
    name: "up next offers the sequel to a finished volume",
    run: () => {
      const row = shelfFor(SHELF).row("next");
      assert(!!row, "expected an up-next row");
      assert(row!.records.length === 1 && row!.records[0].id === SEQUEL.id, "wrong sequel");
    },
  },
  {
    name: "a sequel already in progress belongs to continue reading, not up next",
    run: () => {
      const started = { ...SEQUEL, lastPercent: 20, lastRead: "2026-08-11" } as WebComicRecord;
      const { row } = shelfFor([READING, FINISHED, started]);
      assert(row("next") === undefined, "up next offered a book already in progress");
      assert(!!row("continue")?.records.some((r) => r.id === started.id), "the sequel left continue reading");
    },
  },
  {
    name: "a lone numbered title never invents a series",
    run: () => {
      // "Fahrenheit 451" parses as volume 451 but has no sibling — the
      // heuristic must stay silent rather than guess.
      const { row } = shelfFor([rec(7, "Fahrenheit 451", { lastPercent: 100, lastRead: "2026-08-09" })]);
      assert(row("next") === undefined, "up next invented a series");
    },
  },
  {
    name: "recently added is newest first, and favorites stands on its own",
    run: () => {
      const { row } = shelfFor(SHELF);
      assert(row("recent")!.records[0].id === FRESH.id, "recently added is not newest first");
      assert(
        row("favorites")!.records.map((r) => r.id).join(",") === String(LOVED.id),
        "favorites row is wrong",
      );
    },
  },
  {
    name: "rows may overlap: a new favorite is both new and a favorite",
    run: () => {
      const both = rec(8, "New And Loved", { dateAdded: "2026-08-18", favorited: true });
      const { row } = shelfFor([both]);
      assert(row("recent")!.records[0].id === both.id, "missing from recently added");
      assert(row("favorites")!.records[0].id === both.id, "missing from favorites");
    },
  },
  {
    name: "each row is capped",
    run: () => {
      const many = Array.from({ length: 30 }, (_, i) =>
        rec(100 + i, `Book ${i}`, { dateAdded: `2026-07-${String((i % 28) + 1).padStart(2, "0")}` }),
      );
      const rows = buildHomeShelves(localHomeSources(many), 12);
      assert(rows.every((r) => r.records.length <= 12), "a row exceeded the limit");
    },
  },
];

export function runHomeShelfVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of HOME_SHELF_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `homeShelves: ${HOME_SHELF_VECTORS.length} ok`
      : `homeShelves: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
