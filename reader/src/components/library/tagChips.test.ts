/** Vector module (see `lib/vectorSuite.test.ts`): tag chips derived from an
 *  in-memory shelf, and the tag filter they drive. Pure — no DOM, no network. */
import { applyClientParams, tagChipsFromRecords } from "./libraryData";
import type { WebComicRecord } from "../../lib/api";

function book(id: number, title: string, tags: string[]): WebComicRecord {
  return { id, title, mediaType: "book", tags } as unknown as WebComicRecord;
}

const SHELF = [
  book(1, "Cannery Row", ["noir", "classics"]),
  book(2, "The Big Sleep", ["noir"]),
  book(3, "Blender Manual", ["reference"]),
  book(4, "Untagged", []),
];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export interface TagChipVector {
  name: string;
  run: () => void;
}

export const TAG_CHIP_VECTORS: TagChipVector[] = [
  {
    name: "chips are alphabetical and counted",
    run: () => {
      const chips = tagChipsFromRecords(SHELF);
      assert(
        chips.map((c) => c.name).join(",") === "classics,noir,reference",
        `unexpected order: ${chips.map((c) => c.name).join(",")}`,
      );
      assert(chips.find((c) => c.name === "noir")?.count === 2, "noir should count two books");
      assert(chips.find((c) => c.name === "classics")?.count === 1, "classics should count one");
    },
  },
  {
    name: "an untagged shelf offers no chips",
    run: () => {
      assert(tagChipsFromRecords([]).length === 0, "empty shelf produced chips");
      assert(tagChipsFromRecords([book(9, "Bare", [])]).length === 0, "untagged book produced a chip");
    },
  },
  {
    name: "grouping is exact, so every chip filters to exactly its own count",
    run: () => {
      // Case-folding "Noir" into "noir" here would produce a chip whose count
      // does not match what selecting it actually shows.
      const mixed = [book(1, "A", ["Noir"]), book(2, "B", ["noir"])];
      const chips = tagChipsFromRecords(mixed);
      assert(chips.length === 2, `expected two distinct chips, got ${chips.length}`);
      for (const chip of chips) {
        const shown = applyClientParams(mixed, { tag: chip.name });
        assert(
          shown.length === chip.count,
          `chip ${chip.name} claims ${chip.count} but filters to ${shown.length}`,
        );
      }
    },
  },
  {
    name: "every chip's count matches what selecting it shows",
    run: () => {
      for (const chip of tagChipsFromRecords(SHELF)) {
        const shown = applyClientParams(SHELF, { tag: chip.name });
        assert(
          shown.length === chip.count,
          `chip ${chip.name} claims ${chip.count} but filters to ${shown.length}`,
        );
      }
    },
  },
  {
    name: "a tag filter composes with the other narrowings",
    run: () => {
      const shown = applyClientParams(SHELF, { tag: "noir", search: "cannery" });
      assert(shown.length === 1 && shown[0].id === 1, "tag + search should intersect");
    },
  },
];

export function runTagChipVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of TAG_CHIP_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `tagChips: ${TAG_CHIP_VECTORS.length} ok`
      : `tagChips: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
