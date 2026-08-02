/**
 * Pure EPUB section-DOM helpers used by TextReader.
 *
 * Footnote detection, note extraction, caret word lookup, and href resolution
 * live here so TextReader owns rendition lifecycle without burying policy
 * inside a thousand-line component.
 */
import type { EpubContents } from "./epub";
import { anchorFromFrame } from "../components/EpubPopover";

/** Longer notes are endnotes-in-disguise; previewing them in a popover is worse
 *  than the navigation we were trying to avoid. */
export const NOTE_MAX = 1200;

/** Many TOCs number their own labels ("II. Letters…"); we prepend our roman
 *  numeral per the design, so strip a leading numbering token to avoid "II. II.". */
export function stripChapterNumber(label: string | undefined | null): string {
  return (label ?? "").trim().replace(/^(?:[IVXLC]+|\d+)\s*[.·:–-]\s*/i, "");
}

export function baseHref(href: string | undefined | null): string {
  if (!href) return "";
  return href.split("#")[0].replace(/^\.\//, "");
}

/** Join a book-relative href against the section that linked to it, landing in
 *  the same path space as `spine.get`. The `epub:///` origin is a throwaway —
 *  URL is just the least error-prone `../` resolver available. */
export function resolveHref(sectionHref: string, href: string): string {
  try {
    const u = new URL(href, `epub:///${sectionHref.replace(/^\//, "")}`);
    return `${decodeURIComponent(u.pathname).replace(/^\//, "")}${u.hash}`;
  } catch {
    return href;
  }
}

/** Publishers mark footnote links three different ways and plenty just wrap a
 *  bare anchor in <sup>, so accept all of them; `resolveNote` is the real
 *  filter — anything it can't turn into note text falls through to navigation. */
export function isNoteref(a: Element): boolean {
  const type = a.getAttribute("epub:type") ?? a.getAttribute("type") ?? "";
  if (/(^|\s)(noteref|footnote)(\s|$)/.test(type)) return true;
  const role = a.getAttribute("role") ?? "";
  if (role === "doc-noteref") return true;
  if (a.classList.contains("footnote-ref") || a.classList.contains("noteref")) return true;
  return a.parentElement?.tagName.toLowerCase() === "sup";
}

/** The element carrying the id is often an empty anchor sitting just before the
 *  note's real text, so climb until there's something to read. */
export function noteContainer(el: Element): Element {
  let node: Element = el;
  for (let i = 0; i < 3; i++) {
    if ((node.textContent ?? "").trim().length > 1) return node;
    const parent: Element | null = node.parentElement;
    if (!parent || parent.tagName.toLowerCase() === "body") break;
    node = parent;
  }
  return node;
}

/** Note text, minus the "return to text" backlink that would otherwise show up
 *  as a stray arrow or a repeated numeral in the preview. */
export function noteText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const back of clone.querySelectorAll('a[role="doc-backlink"], a[epub\\:type~="backlink"]')) {
    back.remove();
  }
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The word under a point in a section document. Chromium/WebKit expose
 *  `caretRangeFromPoint`, Gecko `caretPositionFromPoint`; neither is in the
 *  standard DOM lib, hence the local widening. */
export function wordAtPoint(doc: Document, x: number, y: number): string | null {
  const d = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (typeof d.caretRangeFromPoint === "function") {
    const range = d.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  } else if (typeof d.caretPositionFromPoint === "function") {
    const pos = d.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (!node || node.nodeType !== 3) return null;

  const text = node.textContent ?? "";
  const isWordChar = (c: string) => /[\p{L}\p{M}'’-]/u.test(c);
  let start = Math.min(offset, text.length);
  let end = start;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  return end > start ? text.slice(start, end) : null;
}

/** Middle of the top edge of a rect, in host viewport space — where a popover
 *  wants to point. */
export function anchorForRect(contents: EpubContents, rect: DOMRect | undefined) {
  if (!rect) return anchorFromFrame(contents.window, 0, 0);
  return anchorFromFrame(contents.window, rect.left + rect.width / 2, rect.top);
}
