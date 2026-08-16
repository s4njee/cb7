/**
 * The local shelf, presented as ordinary library records.
 *
 * Everything above this file — the grid, the readers, the action sheet — works
 * on `WebComicRecord`. A local book is a different *storage*, not a different
 * *thing*, so it is converted here once and then indistinguishable, save for
 * the `source: "local"` discriminator that tells `api.*` which side to write to.
 *
 * Ids are catalog-assigned and live in their own space, so a bare id is
 * ambiguous across sources. That is why the routed calls in `api.ts` take the
 * record rather than an id.
 */
import {
  localList,
  localSetProgress,
  saveLocalCover,
  type LocalBook,
} from "./transport";
import type { WebComicRecord } from "./api";

/** Turn a catalog entry into the record shape the whole UI already speaks. */
export function toRecord(book: LocalBook): WebComicRecord {
  return {
    id: book.id,
    source: "local",
    title: book.title,
    pageCount: book.pageCount,
    fileSize: book.bytes,
    dateAdded: new Date(book.addedAt).toISOString(),
    lastPage: book.progress?.page ?? null,
    lastLocation: book.progress?.location ?? null,
    lastPercent: book.progress?.percent ?? null,
    lastRead: book.progress?.readAt ? new Date(book.progress.readAt).toISOString() : null,
    mediaType: book.mediaType,
    // Resolved by `mediaUrl` into `cb8://localhost/local/<id>/cover`; the proxy
    // ignores the `?width=` hint `coverUrl` appends (covers are stored once, at
    // a sensible size, rather than resized per request like the server's).
    thumbnailUrl: `/local/${book.id}/cover`,
    fileExt: book.ext,
    favorited: book.favorited,
    hasCover: book.cover != null,
    origin: book.origin ?? null,
    tags: book.tags ?? [],
    series: book.series ?? null,
    volume: book.volume ?? null,
    collections: book.collections ?? [],
    linked: book.source === "linked",
    externalPath: book.externalPath ?? null,
    missing: book.missing ?? false,
  };
}

/** The whole on-device shelf, newest first. */
export async function listLocal(): Promise<WebComicRecord[]> {
  const books = await localList();
  return books.map(toRecord).sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));
}

/** Server-relative media paths have a local twin under `/local/`. */
export function localPagePath(id: number, index: number): string {
  return `/local/${id}/page/${index}`;
}

export function localFilePath(id: number): string {
  return `/local/${id}/file`;
}

/* -------------------------------------------------------------- bookmarks */

/** Local bookmarks live in `localStorage`, not the catalog.
 *
 *  A bookmark is a handful of bytes attached to a book you already own, and the
 *  catalog is rewritten atomically on every change — putting bookmarks there
 *  would mean rewriting the whole library index on every tap of the ribbon. The
 *  storage is the same one the session and prefs already trust. */
const BOOKMARK_KEY = "shelf.local.bookmarks";

interface StoredBookmark {
  id: number;
  page: number | null;
  location: string | null;
  note: string | null;
  createdAt: string;
}

type BookmarkMap = Record<string, StoredBookmark[]>;

function readAll(): BookmarkMap {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    const parsed = raw ? (JSON.parse(raw) as BookmarkMap) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map: BookmarkMap): void {
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(map));
  } catch {
    /* storage full or unavailable — the bookmark is lost, reading is not */
  }
}

export function listLocalBookmarks(bookId: number): StoredBookmark[] {
  return readAll()[String(bookId)] ?? [];
}

export function createLocalBookmark(
  bookId: number,
  body: { page?: number; location?: string; note?: string },
): StoredBookmark {
  const map = readAll();
  const list = map[String(bookId)] ?? [];
  const bookmark: StoredBookmark = {
    // Ids only have to be unique within one book's list.
    id: list.reduce((max, b) => Math.max(max, b.id), 0) + 1,
    page: body.page ?? null,
    location: body.location ?? null,
    note: body.note ?? null,
    createdAt: new Date().toISOString(),
  };
  map[String(bookId)] = [...list, bookmark];
  writeAll(map);
  return bookmark;
}

export function deleteLocalBookmark(bookId: number, bookmarkId: number): void {
  const map = readAll();
  const list = map[String(bookId)];
  if (!list) return;
  map[String(bookId)] = list.filter((b) => b.id !== bookmarkId);
  writeAll(map);
}

/** Drop a deleted book's bookmarks, so its ids can't haunt a future book. */
export function forgetLocalBookmarks(bookId: number): void {
  const map = readAll();
  delete map[String(bookId)];
  writeAll(map);
}

/** Write a reading position to the catalog. Same silent-fail contract as the
 *  server call it stands in for: a position that fails to save must never
 *  interrupt reading. */
export function setLocalProgress(
  id: number,
  body: { page?: number; location?: string; percent?: number },
): Promise<void> {
  return localSetProgress(id, body).catch(() => {});
}

/* ----------------------------------------------------------------- covers */

/**
 * Store a cover the webview rendered for a local EPUB or PDF.
 *
 * Rust extracts a CBZ cover itself (it's just the first entry in a zip), but
 * teaching it to parse EPUB and PDF would mean dragging two large parsers into
 * the binary to reproduce work the reader already does on open. So the readers
 * hand the pixels over instead, once, the first time the book is opened.
 *
 * Best-effort throughout: a book with no cover falls back to the typographic
 * gradient, which is a perfectly good cover.
 */
export async function captureLocalCover(id: number, blob: Blob): Promise<void> {
  try {
    const buffer = await blob.arrayBuffer();
    const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
    await saveLocalCover(id, new Uint8Array(buffer), ext);
  } catch {
    /* no cover this time; the gradient stands in and we can try again later */
  }
}
