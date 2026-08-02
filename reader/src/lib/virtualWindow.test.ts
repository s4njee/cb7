/**
 * Pure vectors for {@link computeVirtualWindow} / {@link pageAtScroll}.
 * Typechecked by `pnpm build`; run via tsc + node like the other vector files.
 */
import {
  computeVirtualWindow,
  pageAtScroll,
  windowIndices,
} from "./virtualWindow";

export interface VwVector {
  name: string;
  run: () => void;
}

export const VIRTUAL_WINDOW_VECTORS: VwVector[] = [
  {
    name: "empty total yields empty window",
    run: () => {
      const w = computeVirtualWindow({
        total: 0,
        scrollOffset: 0,
        viewportSize: 500,
        itemSize: 100,
      });
      if (w.start !== 0 || w.end !== 0) throw new Error(JSON.stringify(w));
    },
  },
  {
    name: "1000-page book only mounts a small window",
    run: () => {
      const w = computeVirtualWindow({
        total: 1000,
        scrollOffset: 50_000,
        viewportSize: 800,
        itemSize: 600,
        gap: 16,
        overscan: 3,
      });
      const n = w.end - w.start;
      if (n > 20) throw new Error(`window too large: ${n}`);
      if (w.beforePx <= 0) throw new Error("expected before spacer");
      if (w.afterPx <= 0) throw new Error("expected after spacer");
      const idxs = windowIndices(w);
      if (idxs.length !== n) throw new Error("indices mismatch");
      if (idxs[0] !== w.start) throw new Error("start mismatch");
    },
  },
  {
    name: "pageAtScroll clamps to range",
    run: () => {
      if (pageAtScroll(-10, 100, 0, 50) !== 0) throw new Error("low clamp");
      if (pageAtScroll(999_999, 100, 0, 50) !== 49) throw new Error("high clamp");
    },
  },
  {
    name: "scroll near start mounts from 0",
    run: () => {
      const w = computeVirtualWindow({
        total: 100,
        scrollOffset: 0,
        viewportSize: 400,
        itemSize: 100,
        overscan: 2,
      });
      if (w.start !== 0) throw new Error(`start ${w.start}`);
      if (w.beforePx !== 0) throw new Error(`before ${w.beforePx}`);
    },
  },
];

export function runVirtualWindowVectors(): {
  failures: string[];
  report: string;
} {
  const failures: string[] = [];
  for (const v of VIRTUAL_WINDOW_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `virtualWindow: ${VIRTUAL_WINDOW_VECTORS.length} ok`
      : `virtualWindow: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
