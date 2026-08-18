/** Typed CB8 REST calls layered over the transport. Shapes per docs/CONTRACT.md. */
import {
  apiGet,
  apiSend,
  mediaUrl,
  login as tLogin,
  logout as tLogout,
  setServer as tSetServer,
  getConfig as tGetConfig,
  clearMediaCache as tClearMediaCache,
  mediaCacheInfo as tMediaCacheInfo,
  setMediaCacheCeiling as tSetMediaCacheCeiling,
  localSetFavorite,
  localSetCoverFromPath,
  localClearProgress,
  type ApiError,
} from "./transport";
import {
  listLocal,
  localFilePath,
  localPagePath,
  setLocalProgress,
} from "./localSource";
import {
  adoptGuestBookmarks,
  createStored,
  hydrateLegacyEpub,
  listStored,
  listVisible,
  localOwnerKey,
  parseServerOwnerKey,
  pendingServerKeys,
  planBookmarkSync,
  publicBookmark,
  purgeStored,
  removeStored,
  replaceStored,
  serverOwnerKey,
  setServerId,
  setStoredNote,
  type RemoteBookmark,
} from "./bookmarks";
import { clearLegacyBookmarks, loadLegacyBookmarks } from "./localBookmarks";
import { useSession } from "../store/session";
import { saveGuestProgress } from "./guestProgress";
import {
  enqueueOutbox,
  flushOutbox,
  isOfflineProgressError,
  type OutboxSnapshot,
} from "./progressOutbox";
import { getProgressWriter, type ProgressWriter } from "./progressWrite";

/** In a guest session every server write 401s (see CONTRACT.md). We short-circuit
 *  those writes here — one gate for progress (bookmarks stay on-device) — so guest mode
 *  never fires a request only to swallow the rejection, keeping the console
 *  (and the network) quiet. Reads are unaffected: anonymous GETs succeed. */
function isGuest(): boolean {
  try {
    return useSession.getState().guest;
  } catch {
    return false;
  }
}

const GUEST_WRITE_BLOCKED: ApiError = {
  status: 401,
  code: "guest",
  message: "Guest sessions are read-only.",
};

export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
}

export interface SessionPayload {
  authenticated: boolean;
  user: User | null;
  host?: string;
  guestAccess: boolean;
}

export type MediaType = "comic" | "book";

/** Where a record lives. Absent means `"server"` — the server shapes come
 *  straight off the wire and are never going to carry this field. */
export type Source = "local" | "server";

export interface WebComicRecord {
  id: number;
  /** Undefined on records parsed from the server; set to `"local"` by
   *  {@link ./localSource}. Ids are **not** comparable across sources. */
  source?: Source;
  title: string;
  /** Local embedded creators; server records may omit this field. */
  authors?: string[];
  description?: string | null;
  language?: string | null;
  publisher?: string | null;
  publishedAt?: string | null;
  pageCount: number;
  fileSize: number;
  dateAdded: string;
  tags: string[];
  lastPage: number | null;
  lastLocation: string | null;
  lastPercent: number | null;
  lastRead: string | null;
  mediaType: MediaType;
  thumbnailUrl: string;
  /** Sampled once from the decoded cover thumbnail for ambient UI tinting. */
  dominantColor?: string;
  fileExt: string;
  favorited: boolean;
  /** Local records only: whether a cover has been extracted yet. The readers
   *  use it to render one exactly once (see `captureLocalCover`). */
  hasCover?: boolean;
  /** Local records only: server book this file was saved from, when known. */
  origin?: { server: string; comicId: number } | null;
  /** Local records only: series / volume / collections metadata. */
  series?: string | null;
  volume?: string | null;
  collections?: string[];
  /** Local records only: read in place from an attached linked folder. */
  linked?: boolean;
  /** Local records only: a linked book whose file is missing on disk. */
  missing?: boolean;
  /** Local records only: absolute path a linked book reads from. */
  externalPath?: string | null;
}

/** The one branch that matters. Every call below that could write to the wrong
 *  shelf routes on this, because local and server ids collide freely. */
export function isLocal(record: WebComicRecord): boolean {
  return record.source === "local";
}

export { localSetCoverFromPath };

export interface ComicList {
  records: WebComicRecord[];
  totalCount: number;
}

/** A bookmark is anchored by `page` (comics) or `location` (an EPUB CFI) —
 *  exactly one of the two is set, so both are nullable. */
export interface ServerBookmark {
  id: number;
  page: number | null;
  location: string | null;
  note: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------- auth/config */

export function getSession(): Promise<SessionPayload> {
  return apiGet<SessionPayload>("/api/auth/session");
}

export async function setServer(url: string): Promise<SessionPayload> {
  return (await tSetServer(url)) as SessionPayload;
}

export async function login(
  username: string,
  password: string,
): Promise<{ ok: boolean; user: User }> {
  return (await tLogin(username, password)) as { ok: boolean; user: User };
}

export { toApiError } from "./transport";

/* ------------------------------------------------------- saved servers */

export {
  listServers,
  renameServer,
  forgetServer,
  rememberServerUser,
  type SavedServer,
} from "./transport";

export const logout = tLogout;
export const getConfig = tGetConfig;
export const clearMediaCache = tClearMediaCache;
export const mediaCacheInfo = tMediaCacheInfo;
export const setMediaCacheCeiling = tSetMediaCacheCeiling;

/** Consume a single-use QR pairing token, establishing the session cookie for
 *  the bound user. Anonymous by design (that's the point — the device pairing
 *  in has no session yet), so it deliberately skips the guest write gate.
 *  Any failure — wrong, expired or already used — is an indistinguishable
 *  `401` by contract; never surface the raw message as a reason. */
export async function pairWithToken(token: string): Promise<{ ok: boolean; user: User }> {
  return (await apiSend<{ ok: boolean; user: User }>("POST", "/api/auth/pair", { token })) as {
    ok: boolean;
    user: User;
  };
}

/* ---------------------------------------------------- discovery & pairing */

export {
  discoverySupported,
  DISCOVERY_WINDOW_MS,
  startDiscovery,
  stopDiscovery,
  onDiscoveredServer,
  scanSupported,
  scanQr,
  CAMERA_UNAVAILABLE,
  type DiscoveredServer,
} from "./transport";

/* ---------------------------------------------------------------- haptics */

export { hapticsSupported, hapticTick, type HapticKind } from "./transport";

export { parsePairPayload, type PairPayload, type PairReason } from "./pair";

/* ------------------------------------------------------------ local shelf */

export {
  localSupported,
  localCancelImport,
  localDelete,
  localDownload,
  localImport,
  localAddLinkedFolder,
  localLinkedFolders,
  localLocateLinkedBook,
  localPageCount,
  localRemoveLinkedFolder,
  localRenameCollection,
  localRescanLinkedFolders,
  localScanFolder,
  localSearch,
  localSearchSettings,
  localSetMetadata,
  localSize,
  localClearAll,
  type LocalClearAllResult,
  localToggleCollection,
  onLinkedFoldersChanged,
  onSearchIndexProgress,
  reindexLocalSearch,
  setLocalSearchEnabled,
  onFileDrop,
  onLocalDownloadProgress,
  onLocalImportProgress,
  onMenuCommand,
  onOpenedFiles,
  openLogs,
  openLibraryDir,
  pickAndImportBooks,
  pickAndImportFolder,
  importFolderAtPath,
  pathIsDirectory,
  saveLocalCover,
  setMenuEnabled,
  takeOpenedPaths,
  toggleFullscreen,
  type FolderScan,
  type ImportNote,
  type LocalSearchHit,
  type LocalSearchSettings,
  type SearchIndexProgress,
  type ImportProgress,
  type ImportReport,
  type LinkedFolder,
  type LocalBook,
  type LocalDownloadProgress,
  opdsSupported,
  opdsListCatalogs,
  opdsAddCatalog,
  opdsRemoveCatalog,
  opdsBrowse,
  opdsSearch,
  opdsDownload,
  OPDS_PRESETS,
  type OpdsCatalog,
  type OpdsFeed,
  type OpdsPublication,
  type OpdsNavEntry,
  type OpdsAcquisition,
  type OpdsDownloadResult,
} from "./transport";

export { toRecord, forgetLocalBookmarks, captureLocalCover } from "./localSource";
export { listLocal };

/* ------------------------------------------------------ offline downloads */

export {
  downloadsSupported,
  downloadBook,
  cancelDownload,
  removeDownload,
  listDownloads,
  onDownloadProgress,
  type DownloadInfo,
  type DownloadProgress,
  type DownloadStatus,
} from "./transport";

/* ----------------------------------------------------------------- library */

export type SortBy = "title" | "dateAdded" | "fileSize" | "pageCount" | "lastRead";
export type SortOrder = "asc" | "desc";
export type ReadStatus = "unread" | "in-progress" | "completed";

export interface ListParams {
  search?: string;
  mediaType?: MediaType;
  limit?: number;
  offset?: number;
  sortBy?: SortBy;
  sortOrder?: SortOrder;
  readStatus?: ReadStatus;
  favorites?: boolean;
  tag?: string;
}

function listQuery(params: ListParams): string {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.mediaType) q.set("mediaType", params.mediaType);
  if (params.offset) q.set("offset", String(params.offset));
  if (params.sortBy) q.set("sortBy", params.sortBy);
  if (params.sortOrder) q.set("sortOrder", params.sortOrder);
  if (params.readStatus) q.set("readStatus", params.readStatus);
  if (params.favorites) q.set("favorites", "true");
  if (params.tag) q.set("tag", params.tag);
  q.set("limit", String(params.limit ?? 200));
  return q.toString();
}

export function listComics(params: ListParams): Promise<ComicList> {
  return apiGet<ComicList>(`/api/comics?${listQuery(params)}`);
}

export function continueReading(limit = 1): Promise<WebComicRecord[]> {
  return apiGet<WebComicRecord[]>(`/api/continue-reading?limit=${limit}`);
}

export function getComic(id: number): Promise<WebComicRecord> {
  return apiGet<WebComicRecord>(`/api/comics/${id}`);
}

/* ------------------------------------------ semantic in-book search (server) */

/** One passage from inside a server book. `via` says how it was retrieved:
 *  `semantic` came from the embeddings sidecar (meaning), `keyword` from the
 *  server's Postgres FTS, `both` from the fused ranking. */
export interface ServerSearchHit {
  comicId: number;
  book: string;
  chapter: string | null;
  snippet: string;
  via: "both" | "keyword" | "semantic";
}

/** Search inside the *server's* books by meaning.
 *
 *  This is the one library capability the device cannot do for itself: the
 *  index and the embedding model live on the server. Not every CB8 build has
 *  the sidecar, and older ones lack the route entirely, so a failure here is a
 *  missing capability rather than an error worth showing — callers stop asking
 *  (see `Library`'s support latch) instead of surfacing a red banner. */
export function searchInside(q: string): Promise<ServerSearchHit[]> {
  return apiGet<{ results?: ServerSearchHit[] }>(
    `/api/search?q=${encodeURIComponent(q)}`,
  ).then((body) => body.results ?? []);
}

/** Re-read a record from whichever shelf owns it, so the reader restores the
 *  newest position rather than the possibly-stale one the grid handed over. A
 *  local book that has since been deleted falls back to the record we have —
 *  the reader is already open, and yanking it shut mid-page helps nobody. */
export async function refreshRecord(record: WebComicRecord): Promise<WebComicRecord> {
  if (isLocal(record)) {
    const fresh = (await listLocal()).find((r) => r.id === record.id);
    return fresh ?? record;
  }
  return getComic(record.id);
}

/* ---------------------------------------------------- collections & series */

export interface LibraryInfo {
  id: number;
  name: string;
  comicCount: number;
  mediaType: MediaType | null;
}

export function listLibraries(): Promise<LibraryInfo[]> {
  return apiGet<LibraryInfo[]>(`/api/libraries`);
}

/** Same paged shape and params as `/api/comics`. */
export function libraryComics(id: number, params: ListParams): Promise<ComicList> {
  return apiGet<ComicList>(`/api/libraries/${id}/comics?${listQuery(params)}`);
}

export interface SeriesInfo {
  name: string;
  count: number;
  thumbnailUrl: string | null;
}

/** Every tag on the server, alphabetical. The server returns names only — it
 *  has no per-tag count — so the chip UI shows counts for the on-device shelf
 *  (where the whole catalog is in memory) and names alone for the server. */
export function listTags(): Promise<string[]> {
  return apiGet<string[]>("/api/tags");
}

export function listSeries(): Promise<SeriesInfo[]> {
  return apiGet<SeriesInfo[]>(`/api/series`);
}

/** NOTE: bare array, favorite-overlaid, not paged. */
export function seriesComics(name: string): Promise<WebComicRecord[]> {
  return apiGet<WebComicRecord[]>(`/api/series/${encodeURIComponent(name)}/comics`);
}

/* --------------------------------------------------------------- favorites */

export function setFavorite(record: WebComicRecord, on: boolean): Promise<unknown> {
  if (isLocal(record)) return localSetFavorite(record.id, on);
  if (isGuest()) return Promise.reject(GUEST_WRITE_BLOCKED);
  return apiSend<unknown>(on ? "POST" : "DELETE", `/api/comics/${record.id}/favorite`);
}

/* ----------------------------------------------------------------- history */

export interface HistoryEntry {
  id: number;
  comicId: number;
  comicTitle: string;
  action: "opened" | "closed";
  page: number | null;
  timestamp: string;
}

export interface HistoryResponse {
  entries: HistoryEntry[];
  totalCount: number;
}

export function getHistory(offset = 0, limit = 50): Promise<HistoryResponse> {
  return apiGet<HistoryResponse>(`/api/history?offset=${offset}&limit=${limit}`);
}

/** Fire-and-forget open/close breadcrumbs; skipped for guests and for local
 *  books (history is a server-side ledger about a server-side library — a local
 *  book has no row there, and inventing one would corrupt the stats). */
export function postHistory(
  record: WebComicRecord,
  action: "opened" | "closed",
  page: number | null,
): Promise<unknown> {
  if (isLocal(record) || isGuest()) return Promise.resolve({ ok: true });
  return apiSend<unknown>("POST", `/api/history`, { comicId: record.id, action, page }).catch(
    () => ({}),
  );
}

/* ------------------------------------------------------------------- media */

/** Cover thumbnail URL with a resize width appended to the record's own URL. */
export function coverUrl(record: WebComicRecord, width = 480): string {
  const base = record.thumbnailUrl;
  const joined = base.includes("?") ? `${base}&width=${width}` : `${base}?width=${width}`;
  return mediaUrl(joined);
}

/** Full-res comic page image (0-based). Optional resize width for thumbnails.
 *
 *  A local comic's pages are unzipped on demand in Rust and served through the
 *  same scheme, so `<img src>` is identical on both sides; the resize hint is
 *  server-only (there is no local resizer, and a local page is already on disk). */
export function pageUrl(record: WebComicRecord, index: number, width?: number): string {
  if (isLocal(record)) return mediaUrl(localPagePath(record.id, index));
  const q = width ? `?width=${width}` : "";
  return mediaUrl(`/api/comics/${record.id}/pages/${index}${q}`);
}

/** EPUB / book file bytes (fetched as ArrayBuffer for epub.js). */
export function fileUrl(record: WebComicRecord): string {
  return mediaUrl(isLocal(record) ? localFilePath(record.id) : `/api/comics/${record.id}/file`);
}

export {
  fileByteLength,
  readFileRange,
} from "./transport";

/* ---------------------------------------------------------------- progress */

export interface ProgressBody {
  page?: number;
  location?: string;
  percent?: number;
  completed?: boolean;
}

/** Open reading-session ids keyed by `source:id` — used by the outbox conflict
 *  policy so same-session offline retries push furthest without prompting. */
const openReadingSessions = new Map<string, string>();

function readingKey(record: WebComicRecord): string {
  return `${record.source ?? "server"}:${record.id}`;
}

/** Call when a reader mounts; returns the session id for this open. */
export function beginReadingSession(record: WebComicRecord): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  openReadingSessions.set(readingKey(record), id);
  return id;
}

/** Call when a reader unmounts. */
export function endReadingSession(record: WebComicRecord): void {
  openReadingSessions.delete(readingKey(record));
}

export function getOpenReadingSessionId(record: WebComicRecord): string | null {
  return openReadingSessions.get(readingKey(record)) ?? null;
}

/**
 * Immediate progress write (no debounce). Prefer {@link scheduleProgress} from
 * readers so page-turn bursts collapse. Silent-fail by contract; guest mode
 * stays on-device; offline server writes land in the progress outbox.
 */
export async function putProgress(
  record: WebComicRecord,
  body: ProgressBody,
): Promise<unknown> {
  if (isLocal(record)) return setLocalProgress(record.id, body);
  if (isGuest()) {
    const server = useSession.getState().serverUrl ?? "";
    saveGuestProgress(server, record.id, body);
    return Promise.resolve({ ok: true });
  }
  try {
    return await apiSend<unknown>("PUT", `/api/comics/${record.id}/progress`, body);
  } catch (err) {
    if (isOfflineProgressError(err)) {
      const state = useSession.getState();
      const server = state.serverUrl ?? "";
      const userId = state.user?.id ?? "";
      const sessionId =
        getOpenReadingSessionId(record) ??
        beginReadingSession(record);
      enqueueOutbox(server, userId, record.id, body, sessionId);
      return { ok: true, queued: true };
    }
    throw err;
  }
}

/** Trailing-debounced progress (≈800 ms). Flush on reader close via
 *  {@link flushProgress}. */
export function scheduleProgress(record: WebComicRecord, body: ProgressBody): void {
  progressWriter().schedule(record, body);
}

export function flushProgress(record: WebComicRecord): Promise<void> {
  return progressWriter().flush(record);
}

export function flushAllProgress(): Promise<void> {
  return progressWriter().flushAll();
}

function progressWriter(): ProgressWriter {
  return getProgressWriter(putProgress);
}

/** Drain the offline outbox (online event / app focus). */
export async function syncProgressOutbox(): Promise<OutboxSnapshot> {
  const state = useSession.getState();
  const openSessions = new Map<number, string>();
  for (const [key, sid] of openReadingSessions) {
    const id = Number(key.split(":")[1]);
    if (!Number.isNaN(id)) openSessions.set(id, sid);
  }
  return flushOutbox({
    serverUrl: state.serverUrl,
    userId: state.user?.id ?? null,
    openSessions,
    put: (comicId, body) => putServerProgress(comicId, body),
    fetchRecord: (comicId) => getComic(comicId),
  });
}

export {
  getOutboxSnapshot,
  subscribeOutbox,
  resolveConflictPush,
  resolveConflictDrop,
  type OutboxSnapshot,
  type OutboxEntry,
  type OutboxStatus,
} from "./progressOutbox";

/** Upload a position for a bare *server* comic id. Only the guest-sync flow
 *  needs this: it replays positions saved before sign-in, and all it kept was
 *  the id. Everything else goes through {@link putProgress} with a record. */
export function putServerProgress(id: number, body: ProgressBody): Promise<unknown> {
  return apiSend<unknown>("PUT", `/api/comics/${id}/progress`, body);
}

/** Explicit mark read / unread. `completed: false` also clears nothing else;
 *  use `clearProgress` to reset the position entirely. Guest-blocked (the UI
 *  hides the affordance). */
export function setCompleted(
  record: WebComicRecord,
  completed: boolean,
): Promise<unknown> {
  if (isLocal(record)) {
    // The local catalog has no "completed" flag — being at the end *is* being
    // finished. Marking read pins the position to 100%; unread clears it.
    return completed
      ? setLocalProgress(record.id, {
          percent: 100,
          ...(record.mediaType === "comic" && record.pageCount
            ? { page: record.pageCount - 1 }
            : {}),
        })
      : localClearProgress(record.id);
  }
  if (isGuest()) return Promise.reject(GUEST_WRITE_BLOCKED);
  return apiSend<unknown>("PUT", `/api/comics/${record.id}/progress`, { completed });
}

export function clearProgress(record: WebComicRecord): Promise<unknown> {
  if (isLocal(record)) return localClearProgress(record.id);
  if (isGuest()) return Promise.reject(GUEST_WRITE_BLOCKED);
  return apiSend<unknown>("DELETE", `/api/comics/${record.id}/progress`);
}

/* --------------------------------------------------------------- bookmarks */

export interface NewBookmark {
  /** Comic page index (0-based). */
  page?: number;
  /** EPUB CFI. */
  location?: string;
  note?: string;
}

function bookmarkOwnerKey(record: WebComicRecord): string {
  if (isLocal(record)) return localOwnerKey(record.id);
  const server = useSession.getState().serverUrl ?? "";
  const actor = isGuest() ? "guest" : (useSession.getState().user?.id ?? "guest");
  return serverOwnerKey(server, actor, record.id);
}

function canSyncBookmarks(record: WebComicRecord): boolean {
  return !isLocal(record) && !isGuest() && !!useSession.getState().user;
}

function postRemoteBookmark(comicId: number, body: NewBookmark): Promise<ServerBookmark> {
  return apiSend<ServerBookmark>("POST", `/api/comics/${comicId}/bookmarks`, body);
}

function deleteRemoteBookmark(comicId: number, serverId: number): Promise<unknown> {
  return apiSend<unknown>("DELETE", `/api/comics/${comicId}/bookmarks/${serverId}`);
}

async function pushBookmark(ownerKey: string, comicId: number, row: { id: number; page: number | null; location: string | null; note: string | null }): Promise<void> {
  const body: NewBookmark = {};
  if (row.page != null) body.page = row.page;
  if (row.location) body.location = row.location;
  if (row.note) body.note = row.note;
  const remote = await postRemoteBookmark(comicId, body);
  setServerId(ownerKey, row.id, remote.id);
}

async function dropBookmark(ownerKey: string, comicId: number, localId: number, serverId: number): Promise<void> {
  await deleteRemoteBookmark(comicId, serverId);
  purgeStored(ownerKey, localId);
}

/** Always local-first. A signed-in session merges/pushes when reachable. */
export async function listBookmarks(record: WebComicRecord): Promise<ServerBookmark[]> {
  const key = bookmarkOwnerKey(record);
  if (!isLocal(record)) {
    const server = useSession.getState().serverUrl ?? "";
    const legacy = loadLegacyBookmarks(server, record.id);
    if (legacy.length) {
      hydrateLegacyEpub(
        key,
        legacy.map((b) => ({ cfi: b.cfi, createdAt: b.createdAt })),
      );
      clearLegacyBookmarks(server, record.id);
    }
  }
  const canFetch = !isLocal(record) && !!(useSession.getState().serverUrl);
  if (!canFetch) {
    return listVisible(key).map(publicBookmark);
  }
  try {
    const remote = await apiGet<RemoteBookmark[]>(`/api/comics/${record.id}/bookmarks`);
    const plan = planBookmarkSync(listStored(key), remote);
    replaceStored(key, plan.next);
    if (canSyncBookmarks(record)) {
      for (const row of plan.toPush) {
        try {
          await pushBookmark(key, record.id, row);
        } catch {
          /* keep local; flush retries */
        }
      }
      for (const row of plan.toDelete) {
        if (row.serverId == null) continue;
        try {
          await dropBookmark(key, record.id, row.id, row.serverId);
        } catch {
          /* tombstone stays */
        }
      }
    }
    return listVisible(key).map(publicBookmark);
  } catch {
    return listVisible(key).map(publicBookmark);
  }
}

export async function createBookmark(
  record: WebComicRecord,
  body: NewBookmark,
): Promise<ServerBookmark> {
  const key = bookmarkOwnerKey(record);
  const created = createStored(key, body);
  if (canSyncBookmarks(record)) {
    try {
      await pushBookmark(key, record.id, created);
    } catch {
      /* offline / 401 — the local row is the bookmark */
    }
  }
  return publicBookmark(created);
}

export async function deleteBookmark(
  record: WebComicRecord,
  bookmarkId: number,
): Promise<unknown> {
  const key = bookmarkOwnerKey(record);
  const existing = listStored(key).find((b) => b.id === bookmarkId);
  removeStored(key, bookmarkId);
  if (canSyncBookmarks(record) && existing?.serverId != null) {
    try {
      await dropBookmark(key, record.id, bookmarkId, existing.serverId);
    } catch {
      /* tombstone remains for flush */
    }
  }
  return { ok: true };
}

/** Set or clear a bookmark's note. Always writes locally; a synced bookmark
 *  also PUTs (the server updates only `note`, per CONTRACT.md). A failed PUT
 *  keeps the local note — the next successful edit re-sends it, and the sync
 *  merge prefers the local row. */
export async function setBookmarkNote(
  record: WebComicRecord,
  bookmarkId: number,
  note: string | null,
): Promise<ServerBookmark | null> {
  const key = bookmarkOwnerKey(record);
  const updated = setStoredNote(key, bookmarkId, note);
  if (!updated) return null;
  if (canSyncBookmarks(record) && updated.serverId != null) {
    try {
      await apiSend<unknown>("PUT", `/api/comics/${record.id}/bookmarks/${updated.serverId}`, {
        note: updated.note,
      });
    } catch {
      /* offline / 401 — the local note stands */
    }
  }
  return publicBookmark(updated);
}

/** Drain pending bookmark POSTs/DELETEs (online event / app focus / sign-in). */
export async function syncBookmarksOutbox(): Promise<void> {
  const state = useSession.getState();
  if (state.guest || !state.user || !state.serverUrl) return;
  adoptGuestBookmarks(state.serverUrl, state.user.id);
  const actor = state.user.id;
  for (const key of pendingServerKeys(state.serverUrl, actor)) {
    const parsed = parseServerOwnerKey(key);
    if (!parsed) continue;
    for (const row of listStored(key)) {
      try {
        if (row.deleted && row.serverId != null) {
          await dropBookmark(key, parsed.bookId, row.id, row.serverId);
        } else if (!row.deleted && row.serverId == null) {
          await pushBookmark(key, parsed.bookId, row);
        }
      } catch (err) {
        if (isOfflineProgressError(err)) return;
      }
    }
  }
}

/** Move guest-created bookmarks to the current signed-in account and report
 *  how many bookmark rows were adopted for the Settings summary. */
export function adoptGuestBookmarkData(serverUrl: string, userId: string): number {
  return adoptGuestBookmarks(serverUrl, userId);
}
