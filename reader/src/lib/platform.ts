/**
 * Platform boundary — the one module that knows what machine the app is on.
 *
 * Facts come from **Rust** (`platform_info`), never from `navigator.userAgent`:
 * the UA string is spoofable and differs between webviews, and guessing "is it
 * Windows or not" from it is exactly the kind of check that breaks one platform
 * while the other three keep working. Rust knows the target at compile time, so
 * the answer is exact by construction.
 *
 * The tricky bit is that media URLs (`<img src>` for covers and pages) are built
 * **synchronously** at render time, but `platform_info` is an async invoke. So
 * the facts are resolved once during boot — {@link initPlatform} is awaited
 * before the library screen renders any cover — and cached. {@link mediaBase}
 * reads the cache synchronously; the fallback only ever matters in the boot
 * window, which never builds a media URL.
 *
 * `isTauri` lives here (not in transport) so the module is a leaf: transport
 * imports it from us, never the other way around.
 */

export const isTauri =
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

export interface PlatformInfo {
  /** `std::env::consts::OS`: `macos` | `windows` | `linux` | `ios` | `android`; `"browser"` in browser dev. */
  os: string;
  isDesktop: boolean;
  /** e.g. `cb8://localhost` / `http://cb8.localhost`, or `""` in browser dev (same-origin). */
  mediaBase: string;
}

let cached: PlatformInfo | null = null;
let inflight: Promise<PlatformInfo> | null = null;

async function fetchPlatformInfo(): Promise<PlatformInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PlatformInfo>("platform_info");
}

/**
 * Resolve and cache platform facts. Awaited at boot before any media URL is
 * built. Idempotent; safe to call from anywhere, any number of times.
 */
export function initPlatform(): Promise<PlatformInfo> {
  if (!isTauri) {
    // Browser dev: same-origin media through the Vite proxy — no scheme.
    if (!cached) cached = { os: "browser", isDesktop: false, mediaBase: "" };
    return Promise.resolve(cached);
  }
  if (!cached && !inflight) {
    inflight = fetchPlatformInfo().then((info) => {
      cached = info;
      return info;
    });
  }
  return inflight ?? Promise.resolve(cached!);
}

/** Synchronous media protocol base. Correct once `initPlatform` has resolved.
 *  The Tauri fallback (`cb8://localhost`) is right for macOS/iOS/Linux and is
 *  only reachable in the pre-boot window, which builds no media URLs. */
export function mediaBase(): string {
  return cached?.mediaBase ?? (isTauri ? "cb8://localhost" : "");
}

/** Whether this is a desktop (macOS / Windows / Linux) Tauri build. Resolves
 *  once {@link initPlatform} has run; false before boot and in browser dev.
 *  No UA sniffing anywhere — this is the Rust value, cached. */
export function isDesktop(): boolean {
  return cached?.isDesktop ?? false;
}

/** Desktop-only capability: native File/View/Window/Help menus. Wired in a
 *  later phase; this flag is where the UI learns the capability exists. */
export function nativeMenus(): boolean {
  return isDesktop();
}

/** Desktop-only capability: OS file drag-and-drop onto the library. Wired in a
 *  later phase; this flag is where the UI learns the capability exists. */
export function dragDrop(): boolean {
  return isDesktop();
}
