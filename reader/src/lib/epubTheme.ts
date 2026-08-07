/** Concrete color values per app theme for the EPUB section document (engines
 *  need real colors, not CSS vars), plus the CSS injected via setStyles.
 *
 *  Page margins and text measure are deliberately NOT set here: under column
 *  pagination `body` padding applies once across the whole column set rather
 *  than per page, so it can't produce per-page margins. TextReader sizes the
 *  host element instead (see `hostMetrics`). */
import type { ThemeName } from "../store/prefs";
import { fontById, fontFaceCss, type FontId } from "./fonts";

export interface EpubColors {
  bg: string;
  fg: string;
  link: string;
  /** Faint rule/border, for tables and blockquotes. */
  rule: string;
}

/* Hearth Noir reading canvas — page themes only, not app chrome.
   Dark matches Flutter/webui black theme (warm page + reading-text). */
const COLORS: Record<ThemeName, EpubColors> = {
  dark: { bg: "#0d0b0a", fg: "#ddd4c3", link: "#e08a6f", rule: "#3a3226" },
  sepia: { bg: "#e8dcc2", fg: "#4a3d28", link: "#8a5320", rule: "#cbbb9c" },
  light: { bg: "#f4efe4", fg: "#2b2620", link: "#9a4a38", rule: "#d0c6b4" },
};

export function epubColors(theme: ThemeName): EpubColors {
  return COLORS[theme];
}

export interface EpubStyleOpts {
  theme: ThemeName;
  fontId: FontId;
  fontSizePercent: number; // e.g. 106
  lineHeight: number;
  /** Scrolled flow needs vertical rhythm between sections; paginated doesn't. */
  scrolled: boolean;
  /** Scrolled content is centered inside a full-surface iframe. */
  scrolledMargin: number;
  scrolledMaxWidthPx: number;
}

/** Full CSS (with @font-face) injected into an EPUB section document so the
 *  book content honors the app theme, font, size and spacing. */
export function epubDocumentCss(opts: EpubStyleOpts): string {
  const c = epubColors(opts.theme);
  const font = fontById(opts.fontId);
  const family = font.stack;
  const scrolledInset = `min(${Math.round(opts.scrolledMargin * 100)}vw, ${Math.round(opts.scrolledMaxWidthPx * opts.scrolledMargin)}px)`;
  // epub.js writes exact width, height, padding and column properties onto the
  // paginated body. Never compete with that geometry: this stylesheet is
  // appended after epub.js formats a section, and an !important width here
  // turns each later CSS column into the clipped overlap seen on iPad.
  const scrolledBodyGeometry = opts.scrolled
    ? `
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: ${opts.scrolledMaxWidthPx}px !important;
  padding: 8px ${scrolledInset} 32px !important;
  margin: 0 auto !important;`
    : "";
  return `
${fontFaceCss(opts.fontId)}
html { background: ${c.bg} !important; font-size: ${opts.fontSizePercent}% !important; }
body {
  background: ${c.bg} !important;
  color: ${c.fg} !important;
  font-family: ${family} !important;
  line-height: ${opts.lineHeight} !important;
  ${scrolledBodyGeometry}
  text-wrap: pretty;
}
p, div, span, section, article, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, em, strong, i, b, figcaption {
  color: ${c.fg} !important;
  background-color: transparent !important;
  font-family: ${family} !important;
}
/* In-book links (TOC entries, cross-references) take the body color with a
   soft underline rather than a saturated accent. A real book opens on
   link-heavy front matter — a table of contents, a list of parts — and
   coloring every one of those the accent turns the whole page blue, which
   reads as "the text is the wrong color". Underline carries the affordance;
   footnote refs keep their own chip treatment below.

   The [href] scope is load-bearing, not tidiness. EPUBs are full of anchors
   that are not links: empty <a id="p42"/> page-break landmarks and
   <a name="ch3"> NCX targets, a habit inherited from EPUB 2 that persists in
   modern files. Plenty of them WRAP body text. text-decoration propagates to
   every descendant and cannot be switched off by a child, so an unscoped "a"
   rule underlines whole paragraphs — sometimes a whole chapter — and nothing
   the book's own CSS does can undo it. Only an anchor with an href is a link.

   (This comment lives inside a template literal: no backticks.) */
a[href], a[href] * { color: ${c.fg} !important; }
a[href] {
  text-decoration: underline !important;
  text-decoration-color: color-mix(in srgb, ${c.fg} 40%, transparent) !important;
  text-underline-offset: 2px;
}
/* Landmark anchors must not inherit a link's look from anywhere. */
a:not([href]) { text-decoration: none !important; }

/* Media — never let an oversized asset blow out the column and swallow a page. */
img, svg, picture, video {
  max-width: 100% !important;
  max-height: ${opts.scrolled ? "none" : "88vh"} !important;
  height: auto !important;
  object-fit: contain;
}
figure { margin: 1em 0 !important; }
figcaption { font-size: 0.82em !important; opacity: 0.75; text-align: center; }

/* Tables — books ship tables far wider than a phone column; cap and rule them
   so they degrade to something readable instead of clipping mid-cell. */
table {
  max-width: 100% !important;
  border-collapse: collapse !important;
  font-size: 0.9em !important;
  margin: 1em 0 !important;
}
td, th {
  border: 1px solid ${c.rule} !important;
  padding: 0.35em 0.5em !important;
  word-break: break-word;
}
th { font-weight: 600 !important; }

blockquote {
  border-left: 2px solid ${c.rule} !important;
  margin: 1em 0 !important;
  padding-left: 1em !important;
}
pre, code { font-size: 0.88em !important; white-space: pre-wrap !important; word-break: break-word; }

/* Footnote refs get a tap target and a hint they're interactive; the popover
   itself is driven from TextReader (see lib/footnotes). */
a[href][epub\\:type~="noteref"], a[href][role="doc-noteref"], .footnote-ref, sup a[href] {
  text-decoration: none !important;
  padding: 0 0.15em;
  border-radius: 3px;
  background: color-mix(in srgb, ${c.link} 14%, transparent) !important;
}
`;
}

/** Host-element geometry for the current margin / measure prefs.
 *  `margin` is a fraction of the viewport width; `columnWidth` a max measure in
 *  `ch` (0 = unconstrained). Applied to the element epub.js renders into. */
export function hostMetrics(margin: number, columnWidth: number, fontSizePx: number) {
  return {
    paddingInline: `${Math.round(margin * 100)}%`,
    maxWidth: columnWidth > 0 ? `${Math.round(columnWidth * fontSizePx * 0.5)}px` : "none",
  };
}
