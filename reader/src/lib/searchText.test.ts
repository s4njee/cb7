/** Vectors for in-book text search helpers. */
import {
  findMatches,
  hitsPerSection,
  matchesLibraryQuery,
  normalizeSpaces,
  parseLibraryQuery,
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
  {
    name: "library search matches series and tags beyond title",
    run: () => {
      const book = {
        title: "Orbital Quiet",
        series: "Kaiju Diaries",
        tags: ["cyberpunk", "manga"],
        collections: ["Reading queue"],
      };
      // Unprefixed search hits any field.
      if (!matchesLibraryQuery(book, "kaiju")) throw new Error("series not matched");
      if (!matchesLibraryQuery(book, "cyberpunk")) throw new Error("tag not matched");
      if (!matchesLibraryQuery(book, "reading queue")) throw new Error("collection not matched");
      if (!matchesLibraryQuery(book, "orbital")) throw new Error("title not matched");
      if (matchesLibraryQuery(book, "wombat")) throw new Error("no match should fail");
    },
  },
  {
    name: "library search honors field prefixes",
    run: () => {
      const book = {
        title: "Orbital Quiet",
        series: "Kaiju Diaries",
        tags: ["cyberpunk"],
      };
      if (!matchesLibraryQuery(book, "series:kaiju")) throw new Error("series: prefix");
      if (!matchesLibraryQuery(book, "tag:cyber")) throw new Error("tag: prefix");
      // tag: must not leak to series/title.
      if (matchesLibraryQuery(book, "tag:kaiju")) throw new Error("tag: leaked to series");
      if (matchesLibraryQuery(book, "series:cyber")) throw new Error("series: leaked to tag");
      // Unknown prefix is treated as a plain (title) query.
      if (!matchesLibraryQuery(book, "orbital")) throw new Error("unprefixed title");
    },
  },
  {
    name: "parseLibraryQuery splits prefixes",
    run: () => {
      const author = parseLibraryQuery("author:asimov");
      if (author.field !== "author" || author.term !== "asimov")
        throw new Error("author parse");
      const series = parseLibraryQuery("Series: Foundation ");
      if (series.field !== "series" || series.term !== "foundation")
        throw new Error("series parse (case-insensitive + trim)");
      const col = parseLibraryQuery("col:to read");
      if (col.field !== "collection" || col.term !== "to read") throw new Error("col alias");
      const plain = parseLibraryQuery("Just a title");
      if (plain.field !== null || plain.term !== "just a title") throw new Error("plain parse");
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
