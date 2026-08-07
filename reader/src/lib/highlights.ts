/** EPUB text highlights. The server has no highlights model and we are not
 *  adding one, so these live in localStorage keyed by server + book id — the
 *  same convention EPUB bookmarks used before they moved server-side.
 *
 *  A stored highlight names a swatch id, never a raw color: the palette is
 *  theme-dependent (see `swatchStyles`) and re-themed on every render, so
 *  baking a hex into storage would freeze last month's dark-mode yellow into a
 *  reader who has since switched to sepia. */
import type { ThemeName } from "../store/prefs";

export type SwatchId = "yellow" | "green" | "blue" | "pink" | "purple";

export interface Swatch {
  id: SwatchId;
  label: string;
  /** Chip color in the app chrome. The in-book paint is derived per theme. */
  chip: string;
}

export const SWATCHES: Swatch[] = [
  { id: "yellow", label: "Yellow", chip: "#f2c94c" },
  { id: "green", label: "Green", chip: "#6fcf97" },
  { id: "blue", label: "Blue", chip: "#6aa9f2" },
  { id: "pink", label: "Pink", chip: "#f178a8" },
  { id: "purple", label: "Purple", chip: "#b08ef0" },
];

const BY_ID = new Map(SWATCHES.map((s) => [s.id, s]));

export const DEFAULT_SWATCH: SwatchId = "yellow";

export function swatchById(id: string | undefined | null): Swatch {
  return BY_ID.get(id as SwatchId) ?? BY_ID.get(DEFAULT_SWATCH)!;
}

/** Highlight paint color (drawer chips + future Readium Decorator styles). */
export function swatchColor(id: string, theme: ThemeName): string {
  const chip = swatchById(id).chip;
  const alpha = theme === "dark" ? 0.45 : 0.4;
  const r = parseInt(chip.slice(1, 3), 16);
  const g = parseInt(chip.slice(3, 5), 16);
  const b = parseInt(chip.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function swatchStyles(id: string, theme: ThemeName): Record<string, string> {
  return { fill: swatchColor(id, theme) };
}

export interface StoredHighlight {
  /** CFI range, and the identity of the highlight — one per range. */
  cfi: string;
  color: SwatchId;
  /** Excerpt captured at creation: the section may not be loaded when the
   *  drawer lists it, so the text can't be re-derived from the CFI on demand. */
  text: string;
  createdAt: number;
}

function key(serverUrl: string, bookId: number): string {
  return `shelf.highlights.${serverUrl}.${bookId}`;
}

export function loadHighlights(serverUrl: string, bookId: number): StoredHighlight[] {
  try {
    const raw = localStorage.getItem(key(serverUrl, bookId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredHighlight[];
    return Array.isArray(parsed) ? parsed.filter((h) => h && typeof h.cfi === "string") : [];
  } catch {
    return [];
  }
}

export function saveHighlights(
  serverUrl: string,
  bookId: number,
  list: StoredHighlight[],
): void {
  try {
    localStorage.setItem(key(serverUrl, bookId), JSON.stringify(list));
  } catch {
    /* storage full / unavailable — ignore */
  }
}

/** Collapse whitespace and cap the excerpt; EPUB source is full of newlines and
 *  indentation that would otherwise land verbatim in the drawer list. */
export function excerpt(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
