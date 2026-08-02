/**
 * Minimal typed wrapper over epub.js (`epubjs@^0.3.93`). The library ships
 * `.d.ts` files but they are loose/incomplete for the surface we use, so we
 * declare only what this app touches and cast the default export to a factory.
 *
 * Every signature below was read off `node_modules/epubjs/src` rather than the
 * shipped typings, which are wrong in ways that matter here: they declare
 * `getContents(): Contents` (it returns an array), `annotations.highlight(): void`
 * (it returns the Annotation), and omit the third `epubcfi` arg on `resize`.
 */
import ePub from "epubjs";
import { localDownload, localSupported, mediaUrl } from "./transport";
import { localFilePath } from "./localSource";
import type { WebComicRecord } from "./api";

export interface EpubTocItem {
  href: string;
  label?: string;
  subitems?: EpubTocItem[];
}

export interface EpubNavigation {
  toc?: EpubTocItem[];
}

export interface EpubLocationStart {
  percentage?: number;
  cfi?: string;
  href?: string;
}

export interface EpubLocation {
  start?: EpubLocationStart;
  /** Set by epub.js when the displayed range touches the end of the book. */
  atEnd?: boolean;
}

export interface EpubThemeRules {
  [selector: string]: Record<string, string>;
}

export interface EpubContents {
  document?: Document;
  /** The section iframe's window — the only handle on the frame element, and
   *  therefore on mapping in-frame coordinates back to host-page space. */
  window?: Window & { frameElement?: Element | null };
  /** Section body. */
  content?: HTMLElement;
  /** Live DOM Range for a CFI (range or point), resolved in this document. */
  range?: (cfi: string, ignoreClass?: string) => Range | null;
  /** Serialized CFI string, despite the library's `@returns {EpubCFI}` JSDoc. */
  cfiFromRange?: (range: Range, ignoreClass?: string) => string;
  sectionIndex?: number;
}

/** Marks-pane annotation handle. `element` is the `<g>` in the overlay SVG. */
export interface EpubAnnotation {
  element?: SVGElement;
}

export interface EpubAnnotations {
  /** `styles` are SVG presentation ATTRIBUTES (fill, fill-opacity,
   *  mix-blend-mode) merged over epub.js's yellow defaults and applied with
   *  setAttribute — CSS property names are silently ignored. */
  highlight: (
    cfiRange: string,
    data?: Record<string, unknown>,
    cb?: (e: Event) => void,
    className?: string,
    styles?: Record<string, string>,
  ) => EpubAnnotation | undefined;
  /** `type` is part of the storage key, so omitting it silently no-ops. */
  remove: (cfiRange: string, type: "highlight" | "underline" | "mark") => void;
}

/** `rendition:layout` from the OPF. Absent → `""`, never undefined. */
export interface EpubMetadata {
  title?: string;
  creator?: string;
  language?: string;
  layout?: string;
  spread?: string;
  flow?: string;
  direction?: string;
}

export interface EpubPackaging {
  metadata: EpubMetadata;
}

/** iBooks' `com.apple.ibooks.display-options.xml`, epub.js's fallback fixed
 *  layout signal. `fixedLayout` is the STRING "true", not a boolean. */
export interface EpubDisplayOptions {
  fixedLayout?: string;
}

export interface EpubSection {
  href: string;
  index: number;
  /** Resolves to `document.documentElement` (an Element), not a Document —
   *  the library's `@return {document}` JSDoc is wrong. */
  load: (request?: (path: string) => Promise<unknown>) => Promise<Element>;
  document?: Document;
  contents?: Element;
}

export interface EpubSpine {
  /** Accepts a CFI, a spine index, `#idref`, or an href (fragment stripped). */
  get: (target?: string | number) => EpubSection | null;
  /** A plain number property, unlike `locations.length()`. */
  length: number;
}

/** Reflowable books use the continuous manager so Scroll can move vertically
 *  across spine sections instead of stopping at each chapter. */
export type EpubFlow = "paginated" | "scrolled-continuous";
export type EpubSpread = "auto" | "none" | "always";
export type EpubLayout = "reflowable" | "pre-paginated";
export type EpubManager = "default" | "continuous";

export interface EpubRenderOptions {
  width: string;
  height: string;
  spread: EpubSpread;
  flow: EpubFlow;
  manager: EpubManager;
  /** Width (CSS px) below which spreads collapse to one page. epub.js defaults
   *  to 800 — pass 0 with `spread: "always"` so two-page actually forces dual
   *  columns on tablets / phones in landscape. */
  minSpreadWidth?: number;
  /** Omitted for reflowable books: `Rendition.start` only auto-detects
   *  pre-paginated when this is unset, so passing a value always wins. */
  layout?: EpubLayout;
}

export interface EpubRendition {
  themes: {
    default: (rules: EpubThemeRules) => void;
    fontSize: (value: string) => void;
    font: (family: string) => void;
    override: (name: string, value: string, priority?: boolean) => void;
  };
  annotations: EpubAnnotations;
  getContents?: () => EpubContents[];
  /** epub.js lifecycle hooks; `content` fires for every section document as it
   *  is attached — the only reliable place to style the first render. */
  hooks: {
    content: { register: (cb: (contents: EpubContents) => void) => void };
  };
  on: {
    (event: "relocated", cb: (location: EpubLocation) => void): void;
    (event: "rendered", cb: (section: unknown, view: unknown) => void): void;
    (event: "selected", cb: (cfiRange: string, contents: EpubContents) => void): void;
    (
      event: "markClicked",
      cb: (cfiRange: string, data: Record<string, unknown>, contents: EpubContents) => void,
    ): void;
  };
  display: (target?: string | number) => Promise<void>;
  next: () => void;
  prev: () => void;
  resize: (width?: number, height?: number, epubcfi?: string) => void;
  /** Changes flow on a live rendition: it clears the manager and re-displays
   *  at `rendition.location.start.cfi` itself, so position survives. */
  flow: (flow: EpubFlow) => void;
  /** One- vs two-page: `none` | `auto` | `always`. Optional min width (px)
   *  for `auto`. Live call re-lays out without losing the CFI. */
  spread: (spread: EpubSpread, min?: number) => void;
  destroy: () => void;
  location?: EpubLocation;
}

export interface EpubLocations {
  generate: (charsPerLocation?: number) => Promise<string[]>;
  /** Null until `generate` has run. */
  percentageFromCfi: (cfi: string) => number | null;
  locationFromCfi?: (cfi: string) => number;
  /** Returns the number -1 when `loc` is out of range, not a CFI. */
  cfiFromLocation?: (loc: number) => string | number;
  /** Takes a 0–1 fraction, not a percent. */
  cfiFromPercentage?: (percentage: number) => string;
  length: () => number;
}

export interface EpubBook {
  /** Per-part unpack promises. `metadata` and `displayOptions` always settle,
   *  but `navigation` can hang forever: epub.js fetches the nav document
   *  without a `.catch`, so a book whose OPF points at a missing NCX never
   *  resolves it — and `ready` awaits all of them. Never block a render on
   *  `ready`; await the narrow promise you actually need. */
  loaded: {
    navigation: Promise<EpubNavigation>;
    metadata: Promise<EpubMetadata>;
    displayOptions: Promise<EpubDisplayOptions>;
  };
  ready?: Promise<unknown>;
  packaging?: EpubPackaging;
  displayOptions?: EpubDisplayOptions;
  spine?: EpubSpine;
  locations?: EpubLocations;
  /** Resolves a path against the book root and reads it through the archive;
   *  the request function `section.load` expects. Bind it before passing. */
  load: (path: string) => Promise<unknown>;
  renderTo: (element: HTMLElement, options: EpubRenderOptions) => EpubRendition;
  /** Blob URL of the cover image the OPF declares, or null when it declares
   *  none. Used to give a local book a real cover on first open. */
  coverUrl?: () => Promise<string | null>;
  destroy?: () => void;
}

type EpubFactory = (data: ArrayBuffer) => EpubBook;

export const createEpub = ePub as unknown as EpubFactory;

/**
 * Read a book's bytes, copying a server book into the local library on the way.
 *
 * epub.js parses from an ArrayBuffer, so the whole file is fetched to open it
 * either way — the bytes land on this device regardless. The only question is
 * whether they land somewhere you keep. Making that the library means opening a
 * book once is enough to own it: it joins your shelf and reopens with the
 * network off. Same reasoning as the PDF path in `lib/pdf.ts`, and doing it for
 * both is what stops two formats behaving differently for no visible reason.
 *
 * `local_download` dedupes on origin, so a reopen is a catalog lookup rather
 * than a second transfer. A failed copy never costs you the book: it falls
 * through to reading over the network exactly as before.
 *
 * Returns the bytes plus the local id when one now exists, so the caller can
 * refresh the shelf.
 */
export async function loadBookData(
  record: Pick<WebComicRecord, "id" | "source" | "title" | "fileExt" | "mediaType" | "pageCount">,
): Promise<{ data: ArrayBuffer; localId: number | null }> {
  if (record.source === "local") {
    return { data: await readAll(mediaUrl(localFilePath(record.id))), localId: record.id };
  }

  if (localSupported) {
    const book = await localDownload({
      comicId: record.id,
      title: record.title,
      ext: record.fileExt || "epub",
      mediaType: record.mediaType,
      pageCount: record.pageCount,
    }).catch(() => null);
    if (book) {
      return { data: await readAll(mediaUrl(localFilePath(book.id))), localId: book.id };
    }
  }

  return { data: await readAll(mediaUrl(`/api/comics/${record.id}/file`)), localId: null };
}

async function readAll(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching book`);
  return resp.arrayBuffer();
}

/** Flatten a (possibly nested) EPUB TOC into a single ordered list. */
export function flattenToc(items: EpubTocItem[] | undefined): EpubTocItem[] {
  const out: EpubTocItem[] = [];
  const walk = (list: EpubTocItem[]) => {
    for (const item of list) {
      out.push({ href: item.href, label: item.label });
      if (item.subitems && item.subitems.length) walk(item.subitems);
    }
  };
  if (items) walk(items);
  return out;
}

/* ------------------------------------------------------------ navigation */

/** Strip a fragment, decode, and drop leading `./` or `/` so two paths from
 *  different bases can be compared. */
function normalizePath(path: string): string {
  let out = path;
  try {
    out = decodeURIComponent(out);
  } catch {
    /* already decoded, or malformed escapes — compare what we were given */
  }
  return out.replace(/^\.?\//, "");
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Map a TOC href onto an href the spine will actually match.
 *
 * **Why this exists.** `Spine.get()` in epub.js ends with
 * `index = this.spineByHref[target] | 0`. On a miss that is `undefined | 0`,
 * which is `0` — so an href it doesn't recognise resolves to the *first spine
 * item* rather than to nothing. `rendition.display()` then cheerfully renders
 * page 1. The failure is silent and looks exactly like "the table of contents
 * is broken": every entry jumps to the start of the book.
 *
 * **Why a miss happens at all.** `spineByHref` is keyed by each section's href
 * as written in the OPF manifest, i.e. relative to the OPF. Navigation hrefs
 * are relative to the *nav document*. The two coincide only when the nav doc
 * sits beside the OPF — very common, which is why this looks fine in most
 * books and breaks in the ones that keep `nav.xhtml` in `Text/` alongside the
 * chapters. Percent-encoding differences (a space as `%20` on one side and a
 * literal space on the other) do it too.
 *
 * So: find the section ourselves, and hand `display()` the section's own href,
 * which is guaranteed to be a `spineByHref` key. Exact match wins; a path
 * suffix is the next best evidence; a bare filename is the last resort. If
 * nothing matches we return the href untouched — the caller is no worse off
 * than before, and a wrong-but-confident guess would be worse than epub.js's.
 */
export function spineTargetFor(book: EpubBook, href: string): string {
  const spine = book.spine;
  // A bare `#id` is a same-document link; epub.js has its own path for those.
  if (!spine || !href || href.startsWith("#")) return href;

  const hash = href.indexOf("#");
  const fragment = hash >= 0 ? href.slice(hash) : "";
  const want = normalizePath(hash >= 0 ? href.slice(0, hash) : href);
  if (!want) return href;

  let bySuffix: string | null = null;
  let byName: string | null = null;

  for (let i = 0; i < spine.length; i++) {
    const section = spine.get(i);
    if (!section?.href) continue;
    const have = normalizePath(section.href);
    if (have === want) return section.href + fragment;
    if (!bySuffix && (have.endsWith(`/${want}`) || want.endsWith(`/${have}`))) {
      bySuffix = section.href;
    }
    if (!byName && basename(have) === basename(want)) byName = section.href;
  }

  const match = bySuffix ?? byName;
  return match ? match + fragment : href;
}

/** Whether the book paints its own fixed pages (comic/manga/picture-book EPUBs).
 *  Mirrors epub.js's own detection in `Rendition.start`: the OPF property, or
 *  iBooks' display-options file, which epub.js only consults when the OPF is
 *  silent. Font, margin and flow controls are meaningless for these. */
export function isFixedLayout(book: EpubBook): boolean {
  return (
    book.packaging?.metadata?.layout === "pre-paginated" ||
    book.displayOptions?.fixedLayout === "true"
  );
}
