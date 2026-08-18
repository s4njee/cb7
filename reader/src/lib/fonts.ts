/** Reading typeface registry. Faces are injected into the epub.js iframe
 *  document, which is sandboxed and cannot see the host page's stylesheets.
 *  Vite resolves these imports to hashed asset URLs at build time, so every
 *  bundled face is available inside the frame (and offline).
 *
 *  App chrome uses SERIF_STACK (Newsreader) / SANS_STACK (Instrument Sans) —
 *  the Hearth Noir pair from the Flutter client. Reading faces are a separate
 *  per-book choice and keep the wider registry.
 *
 *  Weight coverage differs per family — Atkinson Hyperlegible and OpenDyslexic
 *  ship 400/700 only, the text faces ship 400/500/600 — so each family declares
 *  the faces it actually has rather than assuming a common set. */
import newsreader400 from "@fontsource/newsreader/files/newsreader-latin-400-normal.woff2";
import newsreader500 from "@fontsource/newsreader/files/newsreader-latin-500-normal.woff2";
import newsreader600 from "@fontsource/newsreader/files/newsreader-latin-600-normal.woff2";
import newsreaderItalic from "@fontsource/newsreader/files/newsreader-latin-400-italic.woff2";
import literata400 from "@fontsource/literata/files/literata-latin-400-normal.woff2";
import literata500 from "@fontsource/literata/files/literata-latin-500-normal.woff2";
import literata600 from "@fontsource/literata/files/literata-latin-600-normal.woff2";
import literataItalic from "@fontsource/literata/files/literata-latin-400-italic.woff2";
import garamond400 from "@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2";
import garamond500 from "@fontsource/eb-garamond/files/eb-garamond-latin-500-normal.woff2";
import garamond600 from "@fontsource/eb-garamond/files/eb-garamond-latin-600-normal.woff2";
import garamondItalic from "@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff2";
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2";
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff2";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2";
import interItalic from "@fontsource/inter/files/inter-latin-400-italic.woff2";
import atkinson400 from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2";
import atkinson700 from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2";
import atkinsonItalic from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff2";
import dyslexic400 from "@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2";
import dyslexic700 from "@fontsource/opendyslexic/files/opendyslexic-latin-700-normal.woff2";
import dyslexicItalic from "@fontsource/opendyslexic/files/opendyslexic-latin-400-italic.woff2";

export type FontId =
  | "newsreader"
  | "literata"
  | "garamond"
  | "inter"
  | "atkinson"
  | "opendyslexic"
  | "system";

interface FontFace {
  weight: number;
  italic?: boolean;
  url: string;
}

export interface FontDef {
  id: FontId;
  /** Shown in the typeface picker. */
  label: string;
  /** Family name used in @font-face and at the head of the stack. */
  family: string;
  /** Full stack with fallbacks, ready for `font-family`. */
  stack: string;
  /** Bundled faces; empty for families we don't ship (system). */
  faces: FontFace[];
  serif: boolean;
}

const SYSTEM_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

export const FONTS: FontDef[] = [
  {
    id: "newsreader",
    label: "Newsreader",
    family: "Newsreader",
    stack: 'Newsreader, Georgia, "Times New Roman", serif',
    serif: true,
    faces: [
      { weight: 400, url: newsreader400 },
      { weight: 500, url: newsreader500 },
      { weight: 600, url: newsreader600 },
      { weight: 400, italic: true, url: newsreaderItalic },
    ],
  },
  {
    id: "literata",
    label: "Literata",
    family: "Literata",
    stack: 'Literata, Georgia, "Times New Roman", serif',
    serif: true,
    faces: [
      { weight: 400, url: literata400 },
      { weight: 500, url: literata500 },
      { weight: 600, url: literata600 },
      { weight: 400, italic: true, url: literataItalic },
    ],
  },
  {
    id: "garamond",
    label: "Garamond",
    family: "EB Garamond",
    stack: '"EB Garamond", Garamond, Georgia, serif',
    serif: true,
    faces: [
      { weight: 400, url: garamond400 },
      { weight: 500, url: garamond500 },
      { weight: 600, url: garamond600 },
      { weight: 400, italic: true, url: garamondItalic },
    ],
  },
  {
    id: "inter",
    label: "Inter",
    family: "Inter",
    stack: `Inter, ${SYSTEM_SANS}`,
    serif: false,
    faces: [
      { weight: 400, url: inter400 },
      { weight: 500, url: inter500 },
      { weight: 600, url: inter600 },
      { weight: 400, italic: true, url: interItalic },
    ],
  },
  {
    id: "atkinson",
    label: "Atkinson",
    family: "Atkinson Hyperlegible",
    stack: `"Atkinson Hyperlegible", ${SYSTEM_SANS}`,
    serif: false,
    faces: [
      { weight: 400, url: atkinson400 },
      { weight: 700, url: atkinson700 },
      { weight: 400, italic: true, url: atkinsonItalic },
    ],
  },
  {
    id: "opendyslexic",
    label: "Dyslexic",
    family: "OpenDyslexic",
    stack: `OpenDyslexic, ${SYSTEM_SANS}`,
    serif: false,
    faces: [
      { weight: 400, url: dyslexic400 },
      { weight: 700, url: dyslexic700 },
      { weight: 400, italic: true, url: dyslexicItalic },
    ],
  },
  {
    id: "system",
    label: "System",
    family: "system-ui",
    stack: SYSTEM_SANS,
    serif: false,
    faces: [],
  },
];

const BY_ID = new Map(FONTS.map((f) => [f.id, f]));

/** Hearth Noir default reading face — matches app chrome serif. */
export const DEFAULT_FONT_ID: FontId = "newsreader";

export function fontById(id: FontId | undefined | null): FontDef {
  return BY_ID.get(id as FontId) ?? BY_ID.get(DEFAULT_FONT_ID)!;
}

/** Absolute URL — the EPUB iframe resolves relative URLs against its own
 *  document base, where the app's hashed assets don't exist. */
function abs(u: string): string {
  return u.startsWith("http") || u.startsWith("cb8:")
    ? u
    : new URL(u, window.location.href).href;
}

/** @font-face block for one family, pointing at the bundled files. Only the
 *  selected family is emitted — the rest would be dead weight in every
 *  section document. */
export function fontFaceCss(id: FontId): string {
  const def = fontById(id);
  return def.faces
    .map(
      (f) =>
        `@font-face{font-family:'${def.family}';font-style:${
          f.italic ? "italic" : "normal"
        };font-weight:${f.weight};font-display:swap;src:url('${abs(f.url)}') format('woff2');}`,
    )
    .join("\n");
}

/* Stacks for app chrome, which has no per-book typeface. */
export const SERIF_STACK = 'Newsreader, Georgia, "Times New Roman", serif';
export const SANS_STACK = `"Instrument Sans", ${SYSTEM_SANS}`;

/** Accent themes — same six as Flutter AccentTheme, retuned for warm black. */
export type AccentName = "red" | "blue" | "green" | "purple" | "orange" | "teal";

export const ACCENTS: { name: AccentName; label: string; hex: string }[] = [
  { name: "red", label: "Red", hex: "#e15b47" },
  { name: "blue", label: "Blue", hex: "#5b93c7" },
  { name: "green", label: "Green", hex: "#6fa368" },
  { name: "purple", label: "Purple", hex: "#9b7bc0" },
  { name: "orange", label: "Orange", hex: "#d68a30" },
  { name: "teal", label: "Teal", hex: "#5ba79c" },
];

export const DEFAULT_ACCENT: AccentName = "red";
