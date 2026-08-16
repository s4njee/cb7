/**
 * Transport abstraction. Two modes:
 *
 * - **Tauri** (`window.__TAURI_INTERNALS__` present): all JSON goes through
 *   Rust `invoke` commands; media (images / book files) load from the custom
 *   `cb8` URI scheme. The frontend never touches the network directly.
 * - **Browser dev** (no Tauri): JSON via direct `fetch('/api/...', { credentials })`,
 *   media same-origin relative. `vite.config.ts` proxies `/api` to a local CB8.
 *
 * All command failures surface as {@link ApiError} with the same shape the Rust
 * side serializes: `{ status, code?, message }` (status 0 = local/transport).
 */

export interface ApiError {
  status: number;
  code?: string;
  message: string;
}

export interface AppConfig {
  server_url: string | null;
}

// `isTauri` and the media protocol base now come from the platform boundary
// (`platform.ts`), where Rust supplies them instead of a UA sniff. Re-exported
// here so existing `import { isTauri } from "./transport"` callers keep working.
import { isTauri, isDesktop, mediaBase } from "./platform";
export { isTauri, isDesktop };

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    "status" in value
  );
}

export function toApiError(value: unknown): ApiError {
  if (isApiError(value)) return value;
  if (value instanceof Error) return { status: 0, message: value.message };
  return { status: 0, message: String(value ?? "Unknown error") };
}

/* ------------------------------------------------------------------ media */

/** Build a loadable media URL for a server-relative `/api/...` path.
 *
 *  The protocol base comes from the platform boundary (Rust `platform_info`),
 *  resolved once during boot — see `platform.ts`. In browser dev it's `""`
 *  (same-origin through the Vite proxy). */
export function mediaUrl(path: string): string {
  return mediaBase() + path;
}

/* ------------------------------------------------------------------ Tauri */

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let invokeImpl: InvokeFn | null = null;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!invokeImpl) {
    const mod = await import("@tauri-apps/api/core");
    invokeImpl = mod.invoke as InvokeFn;
  }
  try {
    return await invokeImpl<T>(cmd, args);
  } catch (err) {
    throw toApiError(err);
  }
}

/* ------------------------------------------------------------- browser dev */

// In browser mode there is no persisted server config; a successful probe
// stores the same-origin base ('') in memory so the boot flow can route.
let browserServer: string | null = null;

async function browserRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw { status: 0, message: `Cannot reach server: ${String(err)}` } as ApiError;
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const obj = (json ?? {}) as Record<string, unknown>;
    throw {
      status: res.status,
      code: typeof obj.code === "string" ? obj.code : undefined,
      message:
        (typeof obj.message === "string" && obj.message) ||
        (typeof obj.error === "string" && obj.error) ||
        `API error ${res.status}`,
    } as ApiError;
  }
  return json as T;
}

/* --------------------------------------------------------------- commands */

export function getConfig(): Promise<AppConfig> {
  if (isTauri) return invoke<AppConfig>("get_config");
  return Promise.resolve({ server_url: browserServer });
}

export async function setServer(url: string): Promise<unknown> {
  if (isTauri) return invoke<unknown>("set_server", { url });
  // Browser: ignore the address, probe the proxied same-origin session.
  const payload = await browserRequest<unknown>("GET", "/api/auth/session");
  browserServer = "";
  return payload;
}

export function login(username: string, password: string): Promise<unknown> {
  if (isTauri) return invoke<unknown>("login", { username, password });
  return browserRequest<unknown>("POST", "/api/auth/login", { username, password });
}

export async function logout(): Promise<void> {
  if (isTauri) {
    await invoke<void>("logout");
    return;
  }
  try {
    await browserRequest<unknown>("POST", "/api/auth/logout");
  } catch {
    /* best-effort */
  }
}

export function apiGet<T>(path: string): Promise<T> {
  if (isTauri) return invoke<T>("api_get", { path });
  return browserRequest<T>("GET", path);
}

export function apiSend<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (isTauri) return invoke<T>("api_send", { method, path, body });
  return browserRequest<T>(method, path, body);
}

export function clearMediaCache(): Promise<number> {
  if (isTauri) return invoke<number>("clear_media_cache");
  return Promise.resolve(0);
}

/* ------------------------------------------------------------ file ranges */

/** Total byte length of a server file (server-relative `/api/...` path), or
 *  null when the server can't report one (caller falls back to a full read).
 *
 *  Under Tauri this goes through Rust, **not** a webview `fetch`: WKWebView does
 *  not reliably forward a `Range` header to the custom scheme handler, so a
 *  webview probe can miss range support and silently trigger a whole-file
 *  download — which for a 500 MB PDF is an out-of-memory kill. Rust owns the
 *  Range request, so the header always lands. */
export async function fileByteLength(path: string): Promise<number | null> {
  if (isTauri) {
    try {
      return await invoke<number>("file_byte_length", { path });
    } catch {
      return null;
    }
  }
  // Browser dev: same-origin through the Vite proxy, which forwards Range.
  const resp = await fetch(path, { headers: { Range: "bytes=0-0" }, credentials: "include" });
  const total = resp.headers.get("Content-Range")?.match(/\/(\d+)\s*$/)?.[1];
  return total ? Number(total) : null;
}

/** Read a half-open `[begin, end)` byte range of a server file as an
 *  ArrayBuffer, over the network.
 *
 *  Under Tauri this goes through Rust's `read_file_range` command, never a
 *  webview `fetch`: WKWebView does not reliably forward a `Range` header to the
 *  custom scheme handler (same rationale as {@link fileByteLength}), and Rust
 *  attaches the session cookie. In browser dev it's a same-origin ranged
 *  `fetch` (the Vite proxy forwards `/api`). */
export async function readFileRange(
  path: string,
  begin: number,
  end: number,
): Promise<ArrayBuffer> {
  if (isTauri) {
    return invoke<ArrayBuffer>("read_file_range", { path, begin, end });
  }
  const resp = await fetch(path, {
    headers: { Range: `bytes=${begin}-${end - 1}` },
    credentials: "include",
  });
  return resp.arrayBuffer();
}

/* ----------------------------------------------------------- local library */

/** The local library is real files in the app's data directory, so it only
 *  exists under Tauri. In browser dev the on-device shelf is simply empty and
 *  every local command is a no-op — the server shelf still works. */
export const localSupported = isTauri;

export interface LocalProgress {
  page: number | null;
  location: string | null;
  percent: number | null;
  /** Unix milliseconds, or null if never opened. */
  readAt: number | null;
}

/** A book the app owns. Paths are internal (relative to the library root) and
 *  never used by the frontend — media goes through `cb8://…/local/<id>/…`. */
export interface LocalBook {
  id: number;
  title: string;
  file: string;
  cover: string | null;
  ext: string;
  mediaType: "comic" | "book";
  pageCount: number;
  bytes: number;
  /** Unix milliseconds. */
  addedAt: number;
  origin: { server: string; comicId: number } | null;
  progress: LocalProgress;
  favorited: boolean;
}

export interface LocalDownloadProgress {
  comicId: number;
  received: number;
  total: number | null;
  done: boolean;
}

export function localList(): Promise<LocalBook[]> {
  if (!isTauri) return Promise.resolve([]);
  return invoke<LocalBook[]>("local_list");
}

/** Per-file import outcome — every input file gets a verdict, and one bad file
 *  never blocks the rest. Mirrors the Rust `ImportReport`. */
export interface ImportReport {
  added: LocalBook[];
  skipped: ImportNote[];
  failed: ImportNote[];
}

export interface ImportNote {
  path: string;
  reason: string;
}

export function localImport(paths: string[]): Promise<ImportReport> {
  if (!isTauri) return Promise.resolve({ added: [], skipped: [], failed: [] });
  return invoke<ImportReport>("local_import", { paths });
}

/**
 * Drain filesystem paths delivered by Open In / share sheet / Files before the
 * webview was ready (cold start). Returns `[]` when nothing is pending.
 */
export function takeOpenedPaths(): Promise<string[]> {
  if (!isTauri) return Promise.resolve([]);
  return invoke<string[]>("take_opened_paths");
}

/**
 * Subscribe to live open-in events (`RunEvent::Opened` while the app is
 * running). Payload is filesystem paths ready for {@link localImport}.
 */
export async function onOpenedFiles(
  cb: (paths: string[]) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string[]>("shelf://opened-files", (event) => {
    const paths = event.payload ?? [];
    if (paths.length) cb(paths);
  });
}

/** Returns bytes freed. */
export function localDelete(id: number): Promise<number> {
  if (!isTauri) return Promise.resolve(0);
  return invoke<number>("local_delete", { id });
}

export function localDownload(args: {
  comicId: number;
  title: string;
  ext: string;
  mediaType: "comic" | "book";
  pageCount: number;
}): Promise<LocalBook> {
  if (!isTauri)
    return Promise.reject({ status: 0, message: "Downloads need the app" } as ApiError);
  return invoke<LocalBook>("local_download", args);
}

export function localFileLength(id: number): Promise<number> {
  return invoke<number>("local_file_length", { id });
}

export function localReadRange(
  id: number,
  begin: number,
  end: number,
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("local_read_range", { id, begin, end });
}

export function localPageCount(id: number): Promise<number> {
  if (!isTauri) return Promise.resolve(0);
  return invoke<number>("local_page_count", { id });
}

export function localSetProgress(
  id: number,
  body: { page?: number; location?: string; percent?: number },
): Promise<void> {
  if (!isTauri) return Promise.resolve();
  return invoke<void>("local_set_progress", {
    id,
    page: body.page ?? null,
    location: body.location ?? null,
    percent: body.percent ?? null,
  });
}

export function localClearProgress(id: number): Promise<void> {
  if (!isTauri) return Promise.resolve();
  return invoke<void>("local_clear_progress", { id });
}

export function localSetFavorite(id: number, favorited: boolean): Promise<void> {
  if (!isTauri) return Promise.resolve();
  return invoke<void>("local_set_favorite", { id, favorited });
}

/** Total bytes the local library occupies (books + covers). */
export function localSize(): Promise<number> {
  if (!isTauri) return Promise.resolve(0);
  return invoke<number>("local_size");
}

/** Hand Rust a cover the webview rendered (epub.js cover, pdf.js page 1). */
export function saveLocalCover(
  id: number,
  bytes: Uint8Array,
  ext = "jpg",
): Promise<void> {
  if (!isTauri) return Promise.resolve();
  return invoke<void>("save_local_cover", { id, bytes: Array.from(bytes), ext });
}

export async function onLocalDownloadProgress(
  cb: (p: LocalDownloadProgress) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<LocalDownloadProgress>("shelf://local-download-progress", (e) =>
    cb(e.payload),
  );
}

/** Open the system file picker and import whatever was chosen.
 *
 *  Resolves to an {@link ImportReport} — a cancel is not an error, and the
 *  shelf just stays as it was. Desktop pickers get filters so the OS shows only
 *  book files; on iOS/Android the picker stays unfiltered, because filters
 *  become UTIs and `cbz`/`cbr` have no system UTI — a filtered picker would
 *  grey out exactly the files we most want. Rust rejects anything that isn't a
 *  book format after the pick either way. */
export async function pickAndImportBooks(): Promise<ImportReport> {
  if (!isTauri) return { added: [], skipped: [], failed: [] };
  const { open } = await import("@tauri-apps/plugin-dialog");
  const filters = isDesktop()
    ? [
        // CBR is locally readable on desktop (RAR via the unrar crate), so the
        // picker advertises it; mobile has no RAR backend and stays unfiltered
        // anyway (custom UTIs).
        { name: "Books", extensions: ["epub", "pdf", "cbz", "cbr"] },
        { name: "All files", extensions: ["*"] },
      ]
    : undefined;
  const picked = await open({ multiple: true, ...(filters ? { filters } : {}) });
  if (!picked) return { added: [], skipped: [], failed: [] };
  const paths = Array.isArray(picked) ? picked : [picked];
  return localImport(paths.map(String));
}

/* ---------------------------------------------------------- native menus */

/** Subscribe to native menu commands (`shelf://menu-command`). The payload is
 *  the command id the user picked in the native menu, e.g. `"add-books"`.
 *  Resolves to an unlisten function. */
export async function onMenuCommand(
  cb: (command: string) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("shelf://menu-command", (event) => cb(event.payload ?? ""));
}

/* ------------------------------------------------------------- drag/drop */

/** Subscribe to OS file drag-and-drop on the main window (desktop only).
 *  `onHover(true)` fires as files drag over the window, `onDrop(paths)` on a
 *  real drop. Resolves to an unlisten function. */
export async function onFileDrop(
  onHover: (active: boolean) => void,
  onDrop: (paths: string[]) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((event) => {
    const t = event.payload.type;
    if (t === "over") onHover(true);
    else if (t === "drop") {
      onHover(false);
      onDrop(event.payload.paths);
    } else {
      onHover(false); // leave / cancel
    }
  });
}

/* ---------------------------------------------------------------- downloads */

/** Offline pinning is a native capability (files on disk, exempt from the LRU
 *  cache); browser dev has nowhere durable to put a 200 MB comic, so the
 *  feature is simply absent there — gate UI on this flag. */
export const downloadsSupported = isTauri;

export type DownloadStatus =
  | "queued"
  | "active"
  | "paused"
  | "failed"
  | "complete";

export interface DownloadInfo {
  comicId: number;
  title: string;
  mediaType: "comic" | "book";
  /** Work units: page count for comics, 1 (the file) for books. */
  total: number;
  done: number;
  bytes: number;
  complete: boolean;
  /** Lifecycle for the Downloads sheet / detail sheet. */
  status?: DownloadStatus;
  lastError?: string | null;
  /** Incomplete with some units already on disk — Retry resumes. */
  resumable?: boolean;
}

export interface DownloadProgress extends DownloadInfo {
  /** Present when the download failed or was cancelled. */
  error?: string;
}

export function downloadBook(args: {
  comicId: number;
  title: string;
  mediaType: "comic" | "book";
  pageCount: number;
}): Promise<void> {
  if (!isTauri)
    return Promise.reject({ status: 0, message: "Downloads need the app" } as ApiError);
  return invoke<void>("download_book", args);
}

export function cancelDownload(comicId: number): Promise<void> {
  if (!isTauri) return Promise.resolve();
  return invoke<void>("cancel_download", { comicId });
}

/** Returns bytes freed. */
export function removeDownload(comicId: number): Promise<number> {
  if (!isTauri) return Promise.resolve(0);
  return invoke<number>("remove_download", { comicId });
}

export function listDownloads(): Promise<DownloadInfo[]> {
  if (!isTauri) return Promise.resolve([]);
  return invoke<DownloadInfo[]>("list_downloads");
}

/** Subscribe to download progress events; resolves to an unlisten function. */
export async function onDownloadProgress(
  cb: (progress: DownloadProgress) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<DownloadProgress>("shelf://download-progress", (event) => cb(event.payload));
}

/* ---------------------------------------------------------------- discovery */

/** mDNS browsing is a native capability; browser dev has no multicast socket,
 *  so discovery is simply absent there — gate the UI section on this flag. */
export const discoverySupported = isTauri;

/** How long the Rust side keeps a browse window open (CONTRACT.md: 15 s). The
 *  UI mirrors it to retire the "scanning" indicator at the same moment. */
export const DISCOVERY_WINDOW_MS = 15_000;

export interface DiscoveredServer {
  /** TXT `name`, else the mDNS instance name. Display string. */
  name: string;
  /** `http://<ipv4>:<port>` — **the identity**; de-duplicate on it. */
  url: string;
  /** TXT `ver`, or "" when absent. */
  version: string;
  /** Bare resolved IPv4, for the card subtitle. */
  addr: string;
}

/** Start (or keep) a browse window. Idempotent; auto-stops after 15 s.
 *
 *  **Discovery is never an error path** (CONTRACT.md): a browse that cannot
 *  start — no multicast permission, no plugin — resolves normally and simply
 *  emits nothing. Manual entry is the mandatory path, so a rejection here would
 *  only be able to produce a scary error over a feature the user never asked
 *  for. Swallow it. */
export async function startDiscovery(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke<void>("start_discovery");
  } catch {
    /* never an error path — the section just stays empty */
  }
}

/** End the browse window early (connect screen unmount). Always succeeds. */
export async function stopDiscovery(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke<void>("stop_discovery");
  } catch {
    /* idem */
  }
}

/** Subscribe to discovered servers; resolves to an unlisten function.
 *  Browser dev returns a no-op unlisten and never fires. */
export async function onDiscoveredServer(
  cb: (server: DiscoveredServer) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<DiscoveredServer>("shelf://discovered-server", (event) => cb(event.payload));
}

/* ------------------------------------------------------------- QR scanning */

/** Raised when the camera is unavailable (denied, restricted, no hardware) so
 *  the connect screen can show its one specific line instead of a raw message. */
export const CAMERA_UNAVAILABLE = "camera-unavailable";

type ScannerModule = typeof import("@tauri-apps/plugin-barcode-scanner");

function scannerModule(): Promise<ScannerModule> {
  return import("@tauri-apps/plugin-barcode-scanner");
}

let scanSupport: Promise<boolean> | null = null;

/** Whether this platform can scan a QR code with the camera.
 *
 *  A **capability check, not a UA sniff** (QR-3): `plugin-barcode-scanner` is a
 *  mobile-only plugin, so on desktop it is not registered with the Tauri core
 *  and `checkPermissions()` rejects — that rejection *is* the answer, and it is
 *  caught here, so this never throws and never leaks to a caller. The result is
 *  memoized: the answer cannot change within a run.
 *
 *  Note a `denied` permission state still counts as supported — the button must
 *  render so the denial can be explained inline (a hidden button would be an
 *  unexplained dead end). */
export function scanSupported(): Promise<boolean> {
  if (!isTauri) return Promise.resolve(false);
  if (!scanSupport) {
    scanSupport = (async () => {
      try {
        const mod = await scannerModule();
        await mod.checkPermissions();
        return true;
      } catch {
        return false;
      }
    })();
  }
  return scanSupport;
}

/** Scan one QR code. Resolves to the payload text, or **null when the user
 *  cancelled** (a cancel is not an error — the caller just stays put).
 *  Rejects with an {@link ApiError} coded {@link CAMERA_UNAVAILABLE} when
 *  permission is refused. */
export async function scanQr(): Promise<string | null> {
  if (!isTauri)
    throw { status: 0, code: CAMERA_UNAVAILABLE, message: "Scanning needs the app" } as ApiError;

  const mod = await scannerModule();

  let permission = await mod.checkPermissions();
  if (permission !== "granted") permission = await mod.requestPermissions();
  if (permission !== "granted")
    throw { status: 0, code: CAMERA_UNAVAILABLE, message: "Camera permission refused" } as ApiError;

  try {
    const result = await mod.scan({ windowed: false, formats: [mod.Format.QRCode] });
    return result.content || null;
  } catch (err) {
    if (isScanCancel(err)) return null;
    throw toApiError(err);
  }
}

/** The plugin reports a user-dismissed scanner as a rejection whose message
 *  varies by platform ("Scan canceled." / "canceled" / "cancelled"). */
function isScanCancel(err: unknown): boolean {
  const msg = toApiError(err).message.toLowerCase();
  return msg.includes("cancel");
}

/* ----------------------------------------------------------------- haptics */

/** The two things worth feeling while reading.
 *
 *  Named for the *event*, not the waveform: the reader shouldn't have to know
 *  that a chapter is "medium" — only that crossing one is a bigger deal than
 *  turning a page. Keeping the mapping here means retuning the feel is a
 *  one-line change nobody has to go hunting for. */
export type HapticKind = "page" | "chapter";

const HAPTIC_STYLE: Record<HapticKind, "light" | "medium"> = {
  page: "light",
  chapter: "medium",
};

interface HapticsModule {
  impactFeedback: (style: "light" | "medium" | "heavy" | "soft" | "rigid") => Promise<unknown>;
}

function hapticsModule(): Promise<HapticsModule> {
  return import("@tauri-apps/plugin-haptics");
}

let hapticsSupport: Promise<boolean> | null = null;

/** Whether this device can produce haptics — i.e. whether to offer the toggle.
 *
 *  Unlike {@link scanSupported}, this asks **Rust** (`haptics_supported`, a
 *  `cfg!` on the same mobile-only gate that compiles the plugin in) rather than
 *  probing the plugin from here. The plugin has no read-only call: the only way
 *  to ask it "are you there?" is to fire a buzz — which would vibrate the phone
 *  of someone opening the settings drawer *to turn haptics off*. Memoized;
 *  never throws. */
export function hapticsSupported(): Promise<boolean> {
  if (!isTauri) return Promise.resolve(false);
  if (!hapticsSupport) {
    hapticsSupport = invoke<boolean>("haptics_supported").catch(() => false);
  }
  return hapticsSupport;
}

/** Fire one haptic tick. **Fire-and-forget and unfailable by construction.**
 *
 *  A page turn must never wait on the taptic engine, and a device that cannot
 *  buzz (every desktop, a phone with haptics disabled system-wide) must turn
 *  pages exactly as before rather than surfacing an error nobody can act on.
 *  So: no await for the caller, no rejection, no log — silence is the correct
 *  failure mode for a feature you can only feel. */
export function hapticTick(kind: HapticKind): void {
  if (!isTauri) return;
  void (async () => {
    try {
      const mod = await hapticsModule();
      await mod.impactFeedback(HAPTIC_STYLE[kind]);
    } catch {
      /* no taptic engine, or the OS said no — reading continues regardless */
    }
  })();
}
