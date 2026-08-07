/**
 * EPUB book loading helpers shared by the Readium TextReader.
 *
 * Engine-specific navigation lives in `readiumZip.ts` / `readiumView.ts`.
 * This module only fetches bytes and normalizes TOC.
 */
import { localDownload, localSupported, mediaUrl } from "./transport";
import { localFilePath } from "./localSource";
import type { WebComicRecord } from "./api";

export interface EpubTocItem {
  href: string;
  label?: string;
  subitems?: EpubTocItem[];
}

/**
 * Read a book's bytes, copying a server book into the local library on the way.
 *
 * The whole file is fetched to open it either way — the bytes land on this
 * device regardless. Making that the library means opening a book once is
 * enough to own it: it joins your shelf and reopens with the network off.
 *
 * `local_download` dedupes on origin, so a reopen is a catalog lookup rather
 * than a second transfer. A failed copy never costs you the book: it falls
 * through to reading over the network exactly as before.
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
