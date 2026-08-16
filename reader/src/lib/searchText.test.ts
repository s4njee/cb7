/** Vectors for in-book text search helpers. */
import {
  findMatches,
  hitsPerSection,
  normalizeSpaces,
} from "./searchText";

export interface SearchVector {
  name: string;
  run: () => void;
}

export const SEARCH_TEXT_VECTORS: SearchVector[] = [
  {
    name: "finds case-insensitive substring matches",
    run: () => {
      const m = findMatches("Hello hello HELLO", "hello");
      if (m.length !== 3) throw new Error(`expected 3 matches, got ${m.length}`);
      if (m[0].start !== 0) throw new Error(`start ${m[0].start}`);
      if (m[2].start !== 12) throw new Error(`start ${m[2].start}`);
      if (m[0].length !== 5) throw new Error(`length ${m[0].length}`);
    },
  },
  {
    name: "empty query yields no matches",
    run: () => {
      if (findMatches("any text", "").length !== 0) throw new Error("empty query matched");
      if (findMatches("any text", "   ").length !== 0) throw new Error("blank query matched");
    },
  },
  {
    name: "matches across a whitespace run",
    run: () => {
      // "the cat" split across a line break still matches.
      const m = findMatches("see the\ncat now", "the cat");
      if (m.length !== 1) throw new Error(`expected 1 match, got ${m.length}`);
    },
  },
  {
    name: "snippet is non-empty and bounded",
    run: () => {
      const long = "x".repeat(500) + "needle" + "y".repeat(500);
      const m = findMatches(long, "needle");
      if (m.length !== 1) throw new Error(`expected 1 match, got ${m.length}`);
      if (!m[0].snippet.includes("needle")) throw new Error("snippet missing match");
      if (m[0].snippet.length > 200) throw new Error("snippet too long");
    },
  },
  {
    name: "hit-per-section collapses matches and counts them",
    run: () => {
      const hits = hitsPerSection(
        [
          { target: 1, label: "Page 1", text: "the quick the brown" },
          { target: 2, label: "Page 2", text: "no match here" },
          { target: 3, label: "Page 3", text: "the end" },
        ],
        "the",
      );
      if (hits.length !== 2) throw new Error(`expected 2 hits, got ${hits.length}`);
      if (hits[0].count !== 2) throw new Error(`page 1 count ${hits[0].count}`);
      if (hits[0].label !== "Page 1") throw new Error(`label ${hits[0].label}`);
      if (hits[1].count !== 1) throw new Error(`page 3 count ${hits[1].count}`);
    },
  },
  {
    name: "normalizeSpaces collapses whitespace runs",
    run: () => {
      const s = normalizeSpaces("a  b\tc\nd e");
      if (s !== "a b c d e") throw new Error(`got "${s}"`);
    },
  },
];

export function runSearchTextVectors(): {
  failures: string[];
  report: string;
} {
  const failures: string[] = [];
  for (const v of SEARCH_TEXT_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `searchText: ${SEARCH_TEXT_VECTORS.length} ok`
      : `searchText: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
