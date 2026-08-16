/**
 * Minimal typed wrapper over pdf.js (`pdfjs-dist@6.1.200`). Owns the one piece
 * of global setup the library needs (the worker), the document-loading helper,
 * and outline → page-index resolution. Rendering lives in PdfReader.tsx, the
 * same split as lib/epub.ts vs TextReader.tsx.
 *
 * v6 ships real `.d.ts` files, so unlike epub.js we import its types directly
 * rather than re-declaring them.
 */
import {
  getDocument,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  RenderingCancelledException,
} from "pdfjs-dist";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from "pdfjs-dist";
import {
  fileByteLength,
  localDownload,
  localFileLength,
  localReadRange,
  localSupported,
  readFileRange,
} from "./transport";
import type { WebComicRecord } from "./api";
// The worker source, inlined as a string (`?raw`), turned into a `blob:` URL.
//
// Why this shape and not the two obvious alternatives:
//  - `?url` + `workerSrc` (the original) worked in `vite dev` but died on
//    device: iOS/WKWebView serves the app from a custom scheme
//    (`tauri://localhost`), and pdf.js loads its worker with
//    `new Worker(url, { type: "module" })`. A module worker loaded by URL from
//    a custom scheme never reaches Tauri's WKURLSchemeHandler, so the fetch
//    fails — "Setting up fake worker failed: importing a module script failed",
//    and no PDF opens.
//  - `?worker&inline` + `workerPort` fixes the scheme problem (blob-backed) but
//    hands pdf.js one *shared* worker instance; pdf.js terminates it on
//    `loadingTask.destroy()` (every unmount, and twice under StrictMode), so the
//    next open throws "PDFWorker.create - the worker is being destroyed".
//
// A `blob:` URL as `workerSrc` gets both right: it is origin-independent (so it
// bypasses the scheme handler), and pdf.js spawns a *fresh* worker from it per
// document — its normal lifecycle, no shared-instance teardown races. The URL
// is minted once at module scope and lives for the process.
import workerSource from "pdfjs-dist/build/pdf.worker.min.mjs?raw";

GlobalWorkerOptions.workerSrc = URL.createObjectURL(
  new Blob([workerSource], { type: "text/javascript" }),
);

/** One flattened PDF outline entry, already resolved to a page index. */
export interface PdfOutlineEntry {
  title: string;
  /** 0-based. */
  pageIndex: number;
  /** Nesting level in the source outline tree (0 = top level). */
  depth: number;
}

/** Fetches a byte range for pdf.js. On device it reads from the local library
 *  file (a disk read in Rust); in browser dev it's a network `fetch`. */
type RangeReader = (begin: number, end: number) => Promise<ArrayBuffer>;

/** Page a book that is already in the local library. */
async function openLocal(id: number): Promise<PDFDocumentLoadingTask> {
  const length = await localFileLength(id);
  const read: RangeReader = (begin, end) => localReadRange(id, begin, end);
  return getDocument({ range: new RangeTransport(length, read) });
}

/**
 * Feeds pdf.js byte ranges that *we* fetch, instead of letting pdf.js fetch the
 * URL itself.
 *
 * pdf.js's own network layer can't reach the server on device: its ranged
 * requests run inside the worker, and a worker fetch to the `cb8://` custom
 * scheme never reaches Tauri's WKURLSchemeHandler. Worse, trying to hand it the
 * whole file instead is an out-of-memory kill for a 500 MB book. So on device
 * we mirror the native client: the file is streamed to local disk once (see
 * `cacheBookFile`) and every range is a page-sized disk read — pdf.js only ever
 * holds the pages it's showing. In browser dev the reader is a network range
 * `fetch` (the Vite proxy forwards Range fine).
 */
class RangeTransport extends PDFDataRangeTransport {
  private aborted = false;

  constructor(
    length: number,
    private readonly read: RangeReader,
  ) {
    super(length, /* initialData */ null);
  }

  requestDataRange(begin: number, end: number): void {
    this.read(begin, end)
      .then((buf) => {
        if (!this.aborted) this.onDataRange(begin, new Uint8Array(buf));
      })
      .catch(() => {
        // Teardown or transport error — pdf.js rejects the affected page.
      });
  }

  abort(): void {
    this.aborted = true;
  }
}

/**
 * Start loading a PDF.
 *
 * Two paths, both page-at-a-time:
 *
 * - **Local book**: the file is already on disk and owned by the app, so every
 *   range is a straight `seek`+`read` in Rust. Nothing is downloaded, and the
 *   book opens with the network off.
 * - **Server book**: **streamed** from the server. pdf.js asks for the byte
 *   ranges it needs (`file_byte_length` probe, then ranged reads via Rust IPC
 *   on device or a same-origin `fetch` in browser dev), so only the pages you
 *   actually view are transferred and nothing is persisted — opening a book is
 *   no longer a download. If the server ever reports no length, fall back to a
 *   local-library copy on device (a huge PDF must never land in memory whole)
 *   or a single full read in browser dev.
 *
 * Returns the loading task; `task.destroy()` tears the worker down on unmount.
 */
export async function openPdf(
  record: Pick<WebComicRecord, "id" | "source" | "title" | "fileExt" | "mediaType" | "pageCount">,
): Promise<PDFDocumentLoadingTask> {
  if (record.source === "local") return openLocal(record.id);

  const id = record.id;
  const filePath = `/api/comics/${id}/file`;
  const length = await fileByteLength(filePath).catch(() => null);
  if (length != null && length > 0) {
    const read: RangeReader = (begin, end) => readFileRange(filePath, begin, end);
    return getDocument({ range: new RangeTransport(length, read) });
  }

  // No range support (never the case for CB8). On device, stream the file to
  // the local library and page from disk — a huge PDF must never land in
  // memory whole. In browser dev, one full read, parse from memory.
  if (localSupported) {
    const book = await localDownload({
      comicId: id,
      title: record.title,
      ext: record.fileExt || "pdf",
      mediaType: record.mediaType,
      pageCount: record.pageCount,
    }).catch(() => null);
    if (book) return openLocal(book.id);
  }
  const data = await readFileRange(filePath, 0, Number.MAX_SAFE_INTEGER);
  return getDocument({ data });
}

/** Shape of the entries pdf.js returns from `getOutline()`. */
type OutlineNode = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

/** A `{ num, gen }` indirect reference to a page object. */
function isPageRef(value: unknown): value is { num: number; gen: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "num" in value &&
    "gen" in value
  );
}

/**
 * Resolve an outline destination to a 0-based page index.
 *
 * A `dest` is either a named destination (string, needs a lookup) or an already
 * explicit array whose first element is the page — normally an indirect ref,
 * but a page index for documents that inline it. Anything else (external URLs,
 * broken refs) resolves to null.
 */
async function destToPageIndex(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null,
): Promise<number | null> {
  if (!dest) return null;
  let explicit: unknown[] | null;
  try {
    explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
  } catch {
    return null;
  }
  const target = explicit?.[0];
  if (typeof target === "number") return target;
  if (!isPageRef(target)) return null;
  try {
    return await doc.getPageIndex(target);
  } catch {
    return null;
  }
}

/**
 * Flatten a (possibly nested) PDF outline into a single ordered list of
 * entries that actually point somewhere in this document. Returns an empty
 * array for PDFs with no outline — most scanned books have none.
 */
export async function loadOutline(
  doc: PDFDocumentProxy,
): Promise<PdfOutlineEntry[]> {
  let tree: OutlineNode[] | null;
  try {
    tree = await doc.getOutline();
  } catch {
    return [];
  }
  if (!tree || tree.length === 0) return [];

  const out: PdfOutlineEntry[] = [];
  const walk = async (nodes: OutlineNode[], depth: number) => {
    for (const node of nodes) {
      const pageIndex = await destToPageIndex(doc, node.dest);
      if (pageIndex != null) {
        out.push({
          title: (node.title || "").trim() || `Page ${pageIndex + 1}`,
          pageIndex,
          depth,
        });
      }
      if (node.items?.length) await walk(node.items as OutlineNode[], depth + 1);
    }
  };
  await walk(tree, 0);
  return out;
}

/**
 * True when a render rejection is just a cancelled page turn. pdf.js rejects
 * `RenderTask.promise` on `cancel()`, which is expected control flow — never an
 * error to surface.
 */
export function isRenderCancelled(err: unknown): boolean {
  return (
    err instanceof RenderingCancelledException ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "RenderingCancelledException")
  );
}
