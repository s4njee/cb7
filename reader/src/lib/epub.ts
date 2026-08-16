/**
 * EPUB book loading helpers shared by the Readium TextReader.
 *
 * Engine-specific navigation lives in `readiumZip.ts` / `readiumView.ts`.
 * This module only fetches bytes and normalizes TOC.
 */
import { fileByteLength, localFileLength, localReadRange, mediaUrl, readFileRange } from "./transport";
import type { WebComicRecord } from "./api";

export interface EpubTocItem {
  href: string;
  label?: string;
  subitems?: EpubTocItem[];
}

/** Random-access byte source for a book, resolved without downloading it.
 *  `read` is a half-open `[begin, end)` byte range. */
export interface BookByteSource {
  /** Total size of the file in bytes. */
  size: number;
  read(begin: number, end: number): Promise<ArrayBuffer>;
}

/**
 * Resolve a book to a byte source, streaming server books instead of
 * downloading them.
 *
 * A **server book** is read on demand in ranges straight from the server, so
 * opening it transfers only the bytes the reader actually needs (EPUB: the zip
 * central directory plus the current chapter; PDF: page objects). Nothing is
 * written to the local library — owning the book is now an explicit choice
 * ("Save to device" on its detail sheet), not a side effect of opening.
 *
 * A **local book** reads ranges straight from disk, so it still opens with the
 * network off.
 */
export async function loadBookData(
  record: Pick<WebComicRecord, "id" | "source" | "title" | "fileExt" | "mediaType" | "pageCount">,
): Promise<{ source: BookByteSource; localId: number | null }> {
  if (record.source === "local") {
    return { source: await diskSource(record.id), localId: record.id };
  }

  const filePath = `/api/comics/${record.id}/file`;
  const size = await fileByteLength(filePath).catch(() => null);
  if (size != null && size > 0) {
    return {
      source: { size, read: (b, e) => readFileRange(filePath, b, e) },
      localId: null,
    };
  }

  // No range support (never the case for CB8): fall back to a whole-file read.
  const data = await readAll(mediaUrl(filePath));
  return {
    source: { size: data.byteLength, read: async (b, e) => data.slice(b, e) },
    localId: null,
  };
}

/** Byte source for an owned local-library book: disk ranges, offline-capable. */
async function diskSource(id: number): Promise<BookByteSource> {
  return { size: await localFileLength(id), read: (b, e) => localReadRange(id, b, e) };
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
