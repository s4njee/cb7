/** Legacy EPUB bookmarks. Before the server could anchor a bookmark by CFI,
 *  EPUB bookmarks lived only in localStorage, keyed by server + book id. They
 *  are server-side now, so this module exists purely to hand the old entries
 *  over once and then get out of the way — a reader who saved a spot last week
 *  shouldn't lose it to a schema change.
 *
 *  Delete this module (and its use in TextReader) once enough time has passed
 *  that no install is still carrying un-migrated entries. */

export interface LegacyBookmark {
  cfi: string;
  label: string;
  createdAt: number;
}

function key(serverUrl: string, bookId: number): string {
  return `shelf.bookmarks.${serverUrl}.${bookId}`;
}

export function loadLegacyBookmarks(serverUrl: string, bookId: number): LegacyBookmark[] {
  try {
    const raw = localStorage.getItem(key(serverUrl, bookId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LegacyBookmark[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b) => typeof b?.cfi === "string" && b.cfi !== "");
  } catch {
    return [];
  }
}

/** Called only once every entry is safely on the server — dropping them any
 *  earlier would lose the bookmarks of a guest (whose writes 401) or of anyone
 *  who happened to open the book offline. */
export function clearLegacyBookmarks(serverUrl: string, bookId: number): void {
  try {
    localStorage.removeItem(key(serverUrl, bookId));
  } catch {
    /* storage unavailable — the entries are already on the server, so the next
       open simply finds nothing left to migrate */
  }
}
