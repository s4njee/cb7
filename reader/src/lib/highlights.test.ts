/**
 * Vectors for EPUB highlight notes: note set/clear semantics, legacy-row
 * migration, and persistence round-trips.
 */
import {
  loadHighlights,
  loadPdfHighlights,
  saveHighlights,
  savePdfHighlights,
  withPdfHighlightNote,
  withHighlightNote,
  type StoredHighlight,
} from "./highlights";

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

function clearHighlights(): void {
  try {
    localStorage.removeItem("shelf.highlights.http://s.7");
  } catch {
    /* ignore */
  }
}

function hl(cfi: string, partial: Partial<StoredHighlight> = {}): StoredHighlight {
  return {
    cfi,
    color: "yellow",
    text: "some passage",
    note: null,
    createdAt: 1735689600000,
    ...partial,
  };
}

export interface HighlightVector {
  name: string;
  run: () => void;
}

export const HIGHLIGHT_VECTORS: HighlightVector[] = [
  {
    name: "withHighlightNote sets the note on the matching range only",
    run: () => {
      const list = [hl("epubcfi(/6/2)"), hl("epubcfi(/6/4)")];
      const next = withHighlightNote(list, "epubcfi(/6/2)", "payoff is in ch 6");
      if (next[0].note !== "payoff is in ch 6") throw new Error("note not set");
      if (next[1].note !== null) throw new Error("other range touched");
    },
  },
  {
    name: "withHighlightNote blank clears the note",
    run: () => {
      const next = withHighlightNote([hl("epubcfi(/6/2)", { note: "draft" })], "epubcfi(/6/2)", "   ");
      if (next[0].note !== null) throw new Error("blank should clear to null");
    },
  },
  {
    name: "withHighlightNote is a no-op for an unknown range",
    run: () => {
      const list = [hl("epubcfi(/6/2)")];
      const next = withHighlightNote(list, "epubcfi(/9/9)", "nope");
      if (next.length !== 1 || next[0].note !== null) throw new Error("unknown range edited");
    },
  },
  {
    name: "loadHighlights migrates legacy rows without a note to null",
    run: () => {
      ensureLocalStorage();
      clearHighlights();
      localStorage.setItem(
        "shelf.highlights.http://s.7",
        JSON.stringify([{ cfi: "epubcfi(/6/2)", color: "yellow", text: "old", createdAt: 1 }]),
      );
      const loaded = loadHighlights("http://s", 7);
      if (loaded.length !== 1) throw new Error(`loaded ${loaded.length}`);
      if (loaded[0].note !== null) throw new Error("note should default to null");
      clearHighlights();
    },
  },
  {
    name: "notes round-trip through save/load",
    run: () => {
      ensureLocalStorage();
      clearHighlights();
      saveHighlights("http://s", 7, [hl("epubcfi(/6/2)", { note: "kept" })]);
      const loaded = loadHighlights("http://s", 7);
      if (loaded[0].note !== "kept") throw new Error("note lost in round-trip");
      clearHighlights();
    },
  },
  {
    name: "PDF highlight notes and rectangles round-trip locally",
    run: () => {
      ensureLocalStorage();
      const list = [{ id: "pdf:2:1", page: 2, rects: [{ left: 0.1, top: 0.2, width: 0.3, height: 0.04 }], color: "yellow" as const, text: "PDF passage", note: null, createdAt: 1 }];
      savePdfHighlights("http://s", 7, list);
      const loaded = loadPdfHighlights("http://s", 7);
      if (loaded[0]?.rects[0]?.width !== 0.3) throw new Error("PDF rect lost");
      const noted = withPdfHighlightNote(loaded, "pdf:2:1", "keep");
      if (noted[0].note !== "keep") throw new Error("PDF note not set");
    },
  },
];

export function runHighlightVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of HIGHLIGHT_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `highlights: ${HIGHLIGHT_VECTORS.length} ok`
      : `highlights: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
