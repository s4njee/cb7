/** Shared library-surface data helpers: scope model, client-side filter/sort for
 *  the unpaged series scope, and optimistic cache patching for favorite / read
 *  toggles. Kept in the library/ territory so it can be owned independently of
 *  the shared lib/ modules. */
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type {
  ComicList,
  ListParams,
  ReadStatus,
  SortBy,
  SortOrder,
  WebComicRecord,
} from "../../lib/api";
import { hasStarted, isFinished } from "../../lib/format";
import { matchesLibraryQuery } from "../../lib/searchText";

/** What the grid is currently showing. `all` = the whole library (paged);
 *  `collection` = a server library (paged); `series` = one series (bare array). */
export type Scope =
  | { type: "all" }
  | { type: "collection"; id: number; name: string }
  | { type: "series"; name: string };

export function scopeKey(scope: Scope): string {
  switch (scope.type) {
    case "all":
      return "all";
    case "collection":
      return `col:${scope.id}`;
    case "series":
      return `series:${scope.name}`;
  }
}

/** The subset of a record shape a status filter can decide from the record alone. */
export function matchesReadStatus(r: WebComicRecord, status: ReadStatus): boolean {
  switch (status) {
    case "unread":
      return !hasStarted(r);
    case "in-progress":
      return hasStarted(r) && !isFinished(r);
    case "completed":
      return isFinished(r);
  }
}

/** Client-side equivalent of the server list params, for the unpaged series
 *  scope (`/api/series/:name/comics` takes no query). Mirrors what the server
 *  does for `/api/comics` so the two scopes feel identical. */
export function applyClientParams(
  records: WebComicRecord[],
  params: Pick<
    ListParams,
    "search" | "mediaType" | "readStatus" | "favorites" | "sortBy" | "sortOrder"
  > & { tag?: string | null; collection?: string | null },
): WebComicRecord[] {
  let out = records;
  const search = params.search?.trim().toLowerCase();
  // Beyond titles: matches author/series/tags/collections too, honoring
  // `author:` / `series:` / `tag:` prefixes. Local records carry series/tags/
  // collections today; author arrives with area 2 metadata.
  if (search) out = out.filter((r) => matchesLibraryQuery(r, search));
  if (params.mediaType) out = out.filter((r) => r.mediaType === params.mediaType);
  if (params.readStatus) out = out.filter((r) => matchesReadStatus(r, params.readStatus!));
  if (params.favorites) out = out.filter((r) => r.favorited);
  if (params.tag) out = out.filter((r) => (r.tags ?? []).includes(params.tag!));
  if (params.collection)
    out = out.filter((r) => (r.collections ?? []).includes(params.collection!));
  out = sortRecords(out, params.sortBy ?? "title", params.sortOrder ?? "asc");
  return out;
}

function sortRecords(records: WebComicRecord[], sortBy: SortBy, order: SortOrder): WebComicRecord[] {
  const dir = order === "asc" ? 1 : -1;
  const copy = records.slice();
  copy.sort((a, b) => dir * compareBy(a, b, sortBy));
  return copy;
}

function compareBy(a: WebComicRecord, b: WebComicRecord, sortBy: SortBy): number {
  switch (sortBy) {
    case "title":
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
    case "dateAdded":
      return dateVal(a.dateAdded) - dateVal(b.dateAdded);
    case "lastRead":
      // Never-read records sort to the end regardless of direction.
      return nullableDate(a.lastRead) - nullableDate(b.lastRead);
    case "fileSize":
      return a.fileSize - b.fileSize;
    case "pageCount":
      return a.pageCount - b.pageCount;
  }
}

function dateVal(s: string | null): number {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function nullableDate(s: string | null): number {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

/* ---------------------------------------------------- optimistic cache patch */

type AnyCached =
  | WebComicRecord
  | WebComicRecord[]
  | ComicList
  | InfiniteData<ComicList>
  | undefined
  | null;

function patchOne(r: WebComicRecord, id: number, patch: Partial<WebComicRecord>): WebComicRecord {
  return r && r.id === id ? { ...r, ...patch } : r;
}

/** Flip a field on a record wherever it is cached, across every list shape the
 *  library uses (infinite `{pages}`, single `{records}`, bare arrays, and the
 *  lone continue-reading record). Unrelated caches pass through untouched. */
function patchData(data: AnyCached, id: number, patch: Partial<WebComicRecord>): AnyCached {
  if (!data) return data;
  if (Array.isArray(data)) return data.map((r) => patchOne(r, id, patch));
  if ("pages" in data && Array.isArray((data as InfiniteData<ComicList>).pages)) {
    const inf = data as InfiniteData<ComicList>;
    return {
      ...inf,
      pages: inf.pages.map((p) => ({ ...p, records: p.records.map((r) => patchOne(r, id, patch)) })),
    };
  }
  if ("records" in data && Array.isArray((data as ComicList).records)) {
    const list = data as ComicList;
    return { ...list, records: list.records.map((r) => patchOne(r, id, patch)) };
  }
  if ("id" in data && typeof (data as WebComicRecord).id === "number") {
    return patchOne(data as WebComicRecord, id, patch);
  }
  return data;
}

/** Optimistically patch every comic-list cache. Used before a favorite toggle;
 *  the real invalidation follows on settle so filtered lists re-sort/re-page. */
export function patchLibraryCaches(
  qc: QueryClient,
  id: number,
  patch: Partial<WebComicRecord>,
): void {
  for (const prefix of [["comics"], ["seriesComics"], ["continue"]]) {
    qc.setQueriesData<AnyCached>({ queryKey: prefix }, (data) => patchData(data, id, patch));
  }
}

/** Invalidate everything the grid / continue-reading card reads. */
export function invalidateLibrary(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ["comics"] });
  qc.invalidateQueries({ queryKey: ["seriesComics"] });
  qc.invalidateQueries({ queryKey: ["continue"] });
}
