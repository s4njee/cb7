/**
 * Zip-backed Readium Fetcher + client-side EPUB → Web Publication Manifest.
 *
 * Readium's EpubNavigator expects a WebPub (manifest + fetchable resources),
 * not a raw .epub blob. Thorium uses a server-side streamer; in this Tauri app
 * we unpack the EPUB in-process and rewrite relative asset URLs to blob: URLs
 * so frames can load CSS/images without a network streamer.
 *
 * Books are streamed: the zip is read through a {@link RangeZipReader} backed
 * by ranged reads of the book's bytes, and entries are decompressed lazily the
 * first time the reader asks for them. Opening a server EPUB therefore pulls
 * only the zip central directory (a few KB) plus the chapter actually on
 * screen — never the whole book.
 */
import {
  BlobWriter,
  configure,
  Reader,
  TextWriter,
  ZipReader,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";
import type { BookByteSource } from "./epub";
import {
  Locator,
  Manifest,
  Publication,
  Resource,
  type Fetcher,
  type Link,
  type NumberRange,
} from "@readium/shared";

configure({ useWebWorkers: false });

const MIME: Record<string, string> = {
  xhtml: "application/xhtml+xml",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  css: "text/css",
  js: "application/javascript",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  nc: "application/x-dtbncx+xml",
};

function mimeFor(path: string, fallback = "application/octet-stream"): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? fallback;
}

function normalizeZipPath(p: string): string {
  return p.replace(/^\/+/, "").replace(/\\/g, "/");
}

function dirname(p: string): string {
  const n = normalizeZipPath(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(0, i) : "";
}

function resolvePath(baseFile: string, rel: string): string {
  if (/^(https?:|data:|blob:|mailto:|#)/i.test(rel)) return rel;
  const base = dirname(baseFile);
  const joined = normalizeZipPath(base ? `${base}/${rel}` : rel);
  const parts: string[] = [];
  for (const seg of joined.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function basename(path: string): string {
  const n = normalizeZipPath(path);
  return n.slice(n.lastIndexOf("/") + 1);
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** True for cover/title-page style spine items we shouldn't treat as chapter 1. */
export function looksLikeFrontMatter(href: string, label?: string): boolean {
  const hay = `${href} ${label ?? ""}`.toLowerCase();
  return /cover|titlepage|title-page|title_page|halftitle|half-title|copyright|colophon|frontmatter|front-matter/.test(
    hay,
  );
}

/**
 * Map a TOC href onto a readingOrder spine href. Paths are relative to the nav
 * document vs the OPF, so exact matches often fail; fall back to suffix / basename.
 */
export function matchSpineHref(spineHrefs: string[], tocHref: string): string | null {
  if (!tocHref || !spineHrefs.length) return null;
  const hash = tocHref.indexOf("#");
  const wantRaw = normalizeZipPath(hash >= 0 ? tocHref.slice(0, hash) : tocHref);
  const want = decodePath(wantRaw);
  if (!want) return null;

  let bySuffix: string | null = null;
  let byName: string | null = null;
  for (const href of spineHrefs) {
    const have = decodePath(normalizeZipPath(href));
    if (have === want || have === wantRaw) return href;
    if (!bySuffix && (have.endsWith(`/${want}`) || want.endsWith(`/${have}`))) {
      bySuffix = href;
    }
    if (!byName && basename(have) === basename(want)) byName = href;
  }
  return bySuffix ?? byName;
}

export function splitHref(href: string): { path: string; fragment: string } {
  const i = href.indexOf("#");
  if (i < 0) return { path: href, fragment: "" };
  return { path: href.slice(0, i), fragment: href.slice(i + 1) };
}

/** HTML/XHTML (and similar) targets must stay as relative paths so Readium's
 *  in-frame click handler can `path.join(dirname(current), href)` and go().
 *  Rewriting them to blob: URLs made every TOC/chapter link unresolvable and
 *  effectively restarted the book. */
function isDocumentHref(pathOnly: string): boolean {
  const base = pathOnly.split("?")[0].split("#")[0].toLowerCase();
  return /\.(x?html?|xml|nav)$/i.test(base) || base === "" || base.endsWith("/");
}

/**
 * Rewrite url(...) and asset src/href to blob: URLs. Never rewrite document
 * links.
 *
 * Referenced entries are materialized first (decompressing just those, on
 * demand, from a streamed book) because the two rewrite passes below are
 * synchronous — `String.replace` cannot await a per-match promise.
 */
async function rewriteAssetUrls(
  text: string,
  fromFile: string,
  materialize: (path: string) => Promise<Uint8Array | undefined>,
  pathToBlob: Map<string, string>,
  isCss: boolean,
): Promise<string> {
  // Collect every path the passes below would rewrite, resolve it, and pull
  // its bytes now so `pathToBlob` is complete before the sync passes run.
  const wanted = new Set<string>();
  const want = (raw: string) => {
    const cleaned = raw.trim().replace(/^['"]|['"]$/g, "");
    if (!cleaned || /^(https?:|data:|blob:|mailto:|#)/i.test(cleaned)) return;
    const [pathPart] = cleaned.split("#");
    const [pathOnly] = pathPart.split("?");
    wanted.add(resolvePath(fromFile, pathOnly));
  };
  let m: RegExpExecArray | null;
  const urlRe = /url\(\s*([^)]+?)\s*\)/gi;
  while ((m = urlRe.exec(text))) want(m[1]);
  if (!isCss) {
    const attrRe = /\b(src|href)=(["'])([^"']+)\2/gi;
    while ((m = attrRe.exec(text))) {
      const attr = m[1];
      const val = m[3];
      if (/^(https?:|data:|blob:|mailto:|#)/i.test(val)) continue;
      // Keep spine/chapter navigation paths relative for the navigator.
      if (attr.toLowerCase() === "href" && isDocumentHref(val)) continue;
      want(val);
    }
  }
  await Promise.all([...wanted].map((p) => materialize(p).catch(() => undefined)));

  const mapUrl = (raw: string): string => {
    const cleaned = raw.trim().replace(/^['"]|['"]$/g, "");
    if (!cleaned || /^(https?:|data:|blob:|mailto:|#)/i.test(cleaned)) return raw;
    const [pathPart, hash = ""] = cleaned.split("#");
    const [pathOnly, query = ""] = pathPart.split("?");
    const resolved = resolvePath(fromFile, pathOnly);
    const blob = pathToBlob.get(resolved) ?? pathToBlob.get(decodeURIComponent(resolved));
    if (!blob) return raw;
    const q = query ? `?${query}` : "";
    const h = hash ? `#${hash}` : "";
    const q0 = raw.trim()[0];
    if (q0 === '"' || q0 === "'") return `${q0}${blob}${q}${h}${q0}`;
    return `${blob}${q}${h}`;
  };

  let out = text.replace(/url\(\s*([^)]+?)\s*\)/gi, (_m, u: string) => `url(${mapUrl(u)})`);
  if (!isCss) {
    out = out.replace(
      /\b(src|href)=(["'])([^"']+)\2/gi,
      (_m, attr: string, q: string, val: string) => {
        if (/^(https?:|data:|blob:|mailto:|#)/i.test(val)) return `${attr}=${q}${val}${q}`;
        // Keep spine/chapter navigation paths relative for the navigator.
        if (attr.toLowerCase() === "href" && isDocumentHref(val)) {
          return `${attr}=${q}${val}${q}`;
        }
        const mapped = mapUrl(`${q}${val}${q}`);
        if (mapped.startsWith('"') || mapped.startsWith("'")) {
          return `${attr}=${mapped}`;
        }
        return `${attr}=${q}${mapped}${q}`;
      },
    );
  }
  return out;
}

/**
 * zip.js `Reader` over a {@link BookByteSource} — random access by ranged
 * reads, so zip.js only ever pulls the central directory plus the entries the
 * reader actually asks for (one chapter at a time). Reads past the end of the
 * source are truncated, matching zip.js's reader contract.
 */
class RangeZipReader extends Reader<BookByteSource> {
  constructor(private readonly source: BookByteSource) {
    super(source);
    this.size = source.size;
  }

  async init(): Promise<void> {}

  async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    const end = Math.min(index + length, this.source.size);
    if (end <= index) return new Uint8Array();
    return new Uint8Array(await this.source.read(index, end));
  }
}

class ZipResource extends Resource {
  constructor(
    private readonly entryPath: string,
    private readonly linkRef: Link,
    private readonly getBytes: (path: string) => Promise<Uint8Array | undefined>,
    private readonly pathToBlob: Map<string, string>,
    private readonly sizeOf: (path: string) => number | undefined,
  ) {
    super();
  }

  async link(): Promise<Link> {
    return this.linkRef;
  }

  async length(): Promise<number | undefined> {
    // From the zip central directory — decompressing the entry just to report
    // its size would pull a streamed chapter's bytes before it's needed.
    return this.sizeOf(this.entryPath);
  }

  async read(_range?: NumberRange): Promise<Uint8Array | undefined> {
    return this.getBytes(this.entryPath);
  }

  override async readAsString(): Promise<string | undefined> {
    const bytes = await this.getBytes(this.entryPath);
    if (!bytes) return undefined;
    let text = new TextDecoder("utf-8").decode(bytes);
    const type = this.linkRef.type ?? mimeFor(this.entryPath);
    if (type.includes("html") || type.includes("xml") || type.includes("css")) {
      text = await rewriteAssetUrls(
        text,
        this.entryPath,
        this.getBytes,
        this.pathToBlob,
        type.includes("css"),
      );
    }
    return text;
  }

  close(): void {}
}

class ZipFetcher implements Fetcher {
  constructor(
    private readonly pathToBlob: Map<string, string>,
    private readonly getBytes: (path: string) => Promise<Uint8Array | undefined>,
    private readonly sizeOf: (path: string) => number | undefined,
  ) {}

  links(): Link[] {
    return [];
  }

  get(link: Link): Resource {
    // Accept absolute blob URLs, absolute fake-origin URLs, or relative paths.
    let href = link.href.split("#")[0].split("?")[0];
    if (href.startsWith("blob:")) {
      for (const [path, blob] of this.pathToBlob) {
        if (blob === href) {
          href = path;
          break;
        }
      }
    } else if (href.startsWith("https://readium.local/")) {
      href = href.slice("https://readium.local/".length);
    }
    href = normalizeZipPath(decodeURIComponent(href));
    return new ZipResource(href, link, this.getBytes, this.pathToBlob, this.sizeOf);
  }

  close(): void {
    for (const url of this.pathToBlob.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    this.pathToBlob.clear();
  }
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

function attr(el: Element | null, name: string): string {
  return el?.getAttribute(name) ?? "";
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error(`XML parse error: ${err.textContent}`);
  return doc;
}

interface OpfItem {
  id: string;
  href: string; // zip-relative
  mediaType: string;
  properties: string[];
}

function asFileEntry(entry: Entry): FileEntry {
  if (entry.directory || !("getData" in entry)) {
    throw new Error(`Not a file entry: ${entry.filename}`);
  }
  return entry as FileEntry;
}

async function readEntryText(entry: Entry): Promise<string> {
  return asFileEntry(entry).getData(new TextWriter());
}

async function readEntryBytes(entry: Entry): Promise<Uint8Array> {
  const blob: Blob = await asFileEntry(entry).getData(new BlobWriter());
  return new Uint8Array(await blob.arrayBuffer());
}

export interface OpenedReadiumEpub {
  publication: Publication;
  positions: Locator[];
  /** Call on unmount to revoke blob URLs. */
  close: () => void;
  title: string;
  isFixedLayout: boolean;
  toc: Array<{ href: string; label: string }>;
}

/**
 * Open an EPUB as a Readium Publication ready for EpubNavigator.
 *
 * The zip is read through a {@link RangeZipReader}, so `getEntries()` pulls
 * only the central directory and each entry's bytes are decompressed lazily on
 * first request — a streamed server book is never fetched in full.
 */
export async function openEpubAsPublication(source: BookByteSource): Promise<OpenedReadiumEpub> {
  const reader = new ZipReader(new RangeZipReader(source));
  const entries = await reader.getEntries();
  const byPath = new Map<string, Entry>();
  for (const e of entries) {
    if (e.directory) continue;
    byPath.set(normalizeZipPath(e.filename), e);
  }

  const containerEntry = byPath.get("META-INF/container.xml");
  if (!containerEntry) throw new Error("Not a valid EPUB (missing META-INF/container.xml)");
  const containerXml = await readEntryText(containerEntry);
  const containerDoc = parseXml(containerXml);
  const rootfile = containerDoc.querySelector("rootfile")?.getAttribute("full-path");
  if (!rootfile) throw new Error("EPUB container has no rootfile");
  const opfPath = normalizeZipPath(rootfile);
  const opfEntry = byPath.get(opfPath);
  if (!opfEntry) throw new Error(`Missing OPF at ${opfPath}`);
  const opfDir = dirname(opfPath);
  const opfDoc = parseXml(await readEntryText(opfEntry));

  const items = new Map<string, OpfItem>();
  for (const item of Array.from(opfDoc.querySelectorAll("manifest > item"))) {
    const id = attr(item, "id");
    const href = attr(item, "href");
    if (!id || !href) continue;
    const mediaType = attr(item, "media-type") || mimeFor(href);
    const properties = (attr(item, "properties") || "").split(/\s+/).filter(Boolean);
    const zipHref = normalizeZipPath(opfDir ? `${opfDir}/${href}` : href);
    items.set(id, { id, href: zipHref, mediaType, properties });
  }

  const spine: OpfItem[] = [];
  for (const itemref of Array.from(opfDoc.querySelectorAll("spine > itemref"))) {
    const idref = attr(itemref, "idref");
    const linear = attr(itemref, "linear");
    if (linear === "no") continue;
    const it = items.get(idref);
    if (it) spine.push(it);
  }
  if (!spine.length) throw new Error("EPUB spine is empty");

  // Lazy: an entry's bytes are decompressed (and its blob URL created) only
  // when the reader first asks for it — the navigator opens one chapter at a
  // time, so a streamed book pulls just the central directory up front and
  // then each chapter's own bytes as you turn pages. Blob URLs live until
  // `close()`.
  const pathToBlob = new Map<string, string>();
  const bytesCache = new Map<string, Uint8Array>();
  // `decodeURIComponent` throws on malformed escapes (a filename with a
  // literal `%`); a failed decode just means "not this spelling".
  const tryDecode = (p: string): string => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  };
  const getBytes = async (path: string): Promise<Uint8Array | undefined> => {
    const key = normalizeZipPath(path);
    const entry = byPath.get(key) ?? byPath.get(tryDecode(key));
    if (!entry) return undefined;
    const storeKey = normalizeZipPath(entry.filename);
    const cached = bytesCache.get(storeKey);
    if (cached) return cached;
    const bytes = await readEntryBytes(entry);
    bytesCache.set(storeKey, bytes);
    const blob = new Blob([bytes], { type: mimeFor(storeKey) });
    pathToBlob.set(storeKey, URL.createObjectURL(blob));
    return bytes;
  };
  const sizeOf = (path: string): number | undefined => {
    const key = normalizeZipPath(path);
    return byPath.get(key)?.uncompressedSize ?? byPath.get(tryDecode(key))?.uncompressedSize;
  };

  const meta = opfDoc.querySelector("metadata");
  const dcTitle =
    meta?.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "title")[0] ??
    meta?.querySelector("title") ??
    null;
  const dcLang =
    meta?.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "language")[0] ??
    meta?.querySelector("language") ??
    null;
  const title = textOf(dcTitle) || "Untitled";
  const language = textOf(dcLang) || "en";
  const layoutMeta =
    meta?.querySelector('meta[property="rendition:layout"]')?.textContent?.trim() ||
    meta?.querySelector('meta[name="rendition:layout"]')?.getAttribute("content") ||
    "";
  const isFixedLayout = layoutMeta === "pre-paginated";

  // TOC from nav document or NCX
  const toc: Array<{ href: string; label: string }> = [];
  const navDocItem = [...items.values()].find((i) => i.properties.includes("nav"));
  const ncxItem = [...items.values()].find(
    (i) => i.mediaType.includes("ncx") || i.href.toLowerCase().endsWith(".ncx"),
  );

  if (navDocItem) {
    try {
      const navBytes = await getBytes(navDocItem.href);
      const navText = navBytes ? new TextDecoder().decode(navBytes) : "";
      if (navText) {
        const navDoc = new DOMParser().parseFromString(navText, "application/xhtml+xml");
        const OPS = "http://www.idpf.org/2007/ops";
        const pickTocNav = (): Element | null => {
          for (const nav of Array.from(navDoc.querySelectorAll("nav"))) {
            const type =
              nav.getAttributeNS(OPS, "type") ||
              nav.getAttribute("epub:type") ||
              nav.getAttribute("type") ||
              "";
            if (/\btoc\b/i.test(type) || nav.id === "toc" || /toc/i.test(nav.getAttribute("class") || "")) {
              return nav;
            }
          }
          return navDoc.querySelector("nav");
        };
        const walk = (ol: Element) => {
          for (const li of Array.from(ol.children)) {
            if (li.tagName.toLowerCase() !== "li") continue;
            // Prefer a direct (or one-wrap) link for this level, not a nested one.
            let a: Element | null = null;
            for (const child of Array.from(li.children)) {
              const tag = child.tagName.toLowerCase();
              if (tag === "a" && child.getAttribute("href")) {
                a = child;
                break;
              }
              if (tag === "span" || tag === "div") {
                const inner = child.querySelector(":scope > a[href]");
                if (inner) {
                  a = inner;
                  break;
                }
              }
            }
            if (!a) a = li.querySelector(":scope > a[href]");
            if (a) {
              const href = a.getAttribute("href") || "";
              const label = (a.textContent || "").trim();
              if (href && label && !/^(https?:|mailto:)/i.test(href)) {
                const { path, fragment } = splitHref(href);
                const resolved = resolvePath(navDocItem.href, path);
                toc.push({
                  href: fragment ? `${resolved}#${fragment}` : resolved,
                  label,
                });
              }
            }
            const childOl = li.querySelector(":scope > ol");
            if (childOl) walk(childOl);
          }
        };
        const tocNav = pickTocNav();
        const ol = tocNav?.querySelector(":scope > ol") ?? tocNav?.querySelector("ol");
        if (ol) walk(ol);
      }
    } catch {
      /* TOC optional */
    }
  }

  if (!toc.length && ncxItem) {
    try {
      const ncxBytes = await getBytes(ncxItem.href);
      const ncxText = ncxBytes ? new TextDecoder().decode(ncxBytes) : "";
      if (ncxText) {
        const ncxDoc = parseXml(ncxText);
        const walkNcx = (parent: Element) => {
          for (const point of Array.from(parent.children)) {
            if (!/navpoint/i.test(point.tagName)) continue;
            const label =
              textOf(point.querySelector("navLabel text, navlabel text")) ||
              textOf(point.getElementsByTagName("text")[0] ?? null);
            const src =
              point.querySelector("content")?.getAttribute("src") ||
              point.getElementsByTagName("content")[0]?.getAttribute("src") ||
              "";
            if (src && label) {
              const { path, fragment } = splitHref(src);
              const resolved = resolvePath(ncxItem.href, path);
              toc.push({
                href: fragment ? `${resolved}#${fragment}` : resolved,
                label,
              });
            }
            walkNcx(point);
          }
        };
        const navMap =
          ncxDoc.querySelector("navMap, navmap") ||
          ncxDoc.getElementsByTagName("navMap")[0] ||
          ncxDoc.documentElement;
        if (navMap) walkNcx(navMap);
      }
    } catch {
      /* NCX optional */
    }
  }

  const readingOrder = spine.map((s) => ({
    href: s.href,
    type: s.mediaType,
  }));
  const spineHrefs = spine.map((s) => s.href);

  // Remap TOC entries onto spine hrefs so navigator go() can find them.
  const resolvedToc = toc
    .map((t) => {
      const { path, fragment } = splitHref(t.href);
      const spineHref = matchSpineHref(spineHrefs, path);
      if (!spineHref) return null;
      return {
        href: fragment ? `${spineHref}#${fragment}` : spineHref,
        label: t.label,
      };
    })
    .filter((t): t is { href: string; label: string } => t != null);

  // Prefer real TOC; if missing, spine minus obvious front matter for chapter list.
  const chapterToc =
    resolvedToc.length > 0
      ? resolvedToc
      : spine
          .filter((s) => !looksLikeFrontMatter(s.href))
          .map((s, i) => ({ href: s.href, label: `Chapter ${i + 1}` }));

  const resources = [...items.values()]
    .filter((i) => !spine.some((s) => s.id === i.id))
    .map((i) => ({ href: i.href, type: i.mediaType }));

  const rwpm = {
    "@context": "https://readium.org/webpub-manifest/context.jsonld",
    metadata: {
      "@type": "http://schema.org/Book",
      title,
      language,
      identifier: `urn:shelf:epub:${title}`,
      conformsTo: "https://readium.org/webpub-manifest/profiles/epub",
      ...(isFixedLayout ? { layout: "fixed" } : { layout: "reflowable" }),
    },
    links: [
      {
        rel: "self",
        href: "https://readium.local/manifest.json",
        type: "application/webpub+json",
      },
    ],
    readingOrder,
    resources,
    toc: chapterToc.map((t) => ({
      href: t.href.split("#")[0],
      title: t.label,
    })),
  };

  const manifest = Manifest.deserialize(rwpm);
  if (!manifest) throw new Error("Failed to deserialize WebPub manifest");
  manifest.setSelfLink("https://readium.local/manifest.json");

  const fetcher = new ZipFetcher(pathToBlob, getBytes, sizeOf);

  const publication = new Publication({ manifest, fetcher });

  // One locator per spine item. These are resource indices, not typographic
  // pages — UI should label them "Section", not "Page", for reflowable books.
  const positions: Locator[] = spine.map((s, i) => {
    const loc = Locator.deserialize({
      href: s.href,
      type: s.mediaType,
      locations: {
        position: i + 1,
        progression: 0,
        totalProgression: spine.length > 1 ? i / (spine.length - 1) : 0,
      },
    });
    if (!loc) throw new Error("locator");
    return loc;
  });

  return {
    publication,
    positions,
    close: () => {
      fetcher.close();
      void reader.close();
    },
    title,
    isFixedLayout,
    toc: chapterToc,
  };
}

/** First spine position that isn't cover/title-page front matter. */
export function firstReadingPosition(positions: Locator[]): Locator | undefined {
  if (!positions.length) return undefined;
  const body = positions.find((p) => !looksLikeFrontMatter(p.href));
  return body ?? positions[0];
}

