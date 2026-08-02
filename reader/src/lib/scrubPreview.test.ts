/**
 * Vectors for scrub destination labels.
 */
import { chapterAtPage, pageAtPercent, scrubPreview } from "./scrubPreview";

export interface ScrubVector {
  name: string;
  run: () => void;
}

export const SCRUB_PREVIEW_VECTORS: ScrubVector[] = [
  {
    name: "pageAtPercent clamps to range",
    run: () => {
      if (pageAtPercent(0, 100) !== 1) throw new Error("0%");
      if (pageAtPercent(100, 100) !== 100) throw new Error("100%");
      if (pageAtPercent(50, 10) !== 5) throw new Error("50%");
    },
  },
  {
    name: "single page label",
    run: () => {
      const p = scrubPreview({ scrubPct: 25, pageCount: 40, spread: false });
      if (p.label !== "Page 10 of 40") throw new Error(p.label);
      if (p.percent !== 25) throw new Error(String(p.percent));
    },
  },
  {
    name: "spread labels both pages on odd start",
    run: () => {
      const p = scrubPreview({ scrubPct: 0, pageCount: 20, spread: true });
      // page 1 → Pages 1–2
      if (p.label !== "Pages 1–2 of 20") throw new Error(p.label);
    },
  },
  {
    name: "location mode wording",
    run: () => {
      const p = scrubPreview({
        scrubPct: 10,
        pageCount: 50,
        spread: false,
        locationMode: true,
      });
      if (!p.label.startsWith("Location ")) throw new Error(p.label);
    },
  },
  {
    name: "chapterAtPage picks latest chapter at or before page",
    run: () => {
      const ch = [
        { title: "One", target: 0 },
        { title: "Two", target: 10 },
        { title: "Three", target: 20 },
      ];
      if (chapterAtPage(1, ch) !== "One") throw new Error("p1");
      if (chapterAtPage(15, ch) !== "Two") throw new Error("p15");
      if (chapterAtPage(21, ch) !== "Three") throw new Error("p21");
    },
  },
  {
    name: "chapter ignores href targets",
    run: () => {
      const ch = [{ title: "A", target: "chapter1.xhtml" }];
      if (chapterAtPage(5, ch) !== null) throw new Error("href");
    },
  },
  {
    name: "no pageCount falls back to percent only",
    run: () => {
      const p = scrubPreview({ scrubPct: 42.4, pageCount: null, spread: false });
      if (p.label !== "42%") throw new Error(p.label);
    },
  },
];

export function runScrubPreviewVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of SCRUB_PREVIEW_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `scrubPreview: ${SCRUB_PREVIEW_VECTORS.length} ok`
      : `scrubPreview: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
