# CB8

Project documentation: [CB8 Wiki](https://s4njee.github.io/cb7/)

A Tauri v2 ebook & comic reader for **CB8 servers** (the server in `../server`).
Primary deployment targets are **iOS and Android**, plus a **supported desktop
build** (macOS, Windows, Linux) — the same codebase, packaged as native apps.
The UI recreates the iPad-first design handoff (library "Shelf", reflowable
EPUB reader, CBZ/CBR comic reader with single/spread/webtoon layouts, settings
+ TOC/bookmarks drawers, dark/sepia/light themes).

Desktop behavior (window state, native menus, file open/import, drag-and-drop,
release builds) is covered in [DESKTOP.md](DESKTOP.md); the desktop release
plan and support matrix live in [plan-desktop.md](plan-desktop.md) and
[docs/desktop-support-matrix.md](docs/desktop-support-matrix.md).

## Architecture

- **Rust core (`src-tauri/`)** owns all networking:
  - reqwest client with a **persisted cookie store** — better-auth session
    (`cb8.session_token`) survives restarts; sign-in via the server's
    `POST /api/auth/login` wrapper.
  - **invoke commands** for JSON (`api_get`, `api_send`, `login`, `logout`,
    `set_server`, `get_config`, `clear_media_cache`).
  - a **custom `cb8` URI scheme** that proxies binary GETs (covers, comic
    pages, EPUB files) with an on-disk LRU cache (768 MiB, cache-first —
    re-reads work offline). Frontend media URLs: `cb8://localhost/api/...`
    (macOS/iOS/Linux) or `http://cb8.localhost/api/...` (Android/Windows).
  - the **local library**: imported books are copied into app-owned storage
    (`<app_data>/library/books`) with a `catalog.json` index, so they read
    offline and survive the source file being moved or deleted.
- **Frontend (`src/`)**: React 18 + TypeScript + Vite, zustand (persisted
  prefs), react-query (server data), Readium TS Toolkit for EPUB rendering
  (CFI positions synced to the server). No router — a
  `connect → library → reader` state machine.
- **Platform boundary (`src/lib/platform.ts`)**: `isTauri`, `isDesktop`, OS,
  and the media protocol base come from Rust (`platform_info`), never the user
  agent.
- The wire contract and design mapping live in [docs/CONTRACT.md](docs/CONTRACT.md).

Reading progress is synced per turn (`PUT /api/comics/:id/progress` —
`{page}` for comics/PDFs, `{location, percent}` for EPUBs) and restored from a
**fresh** record fetch on open, so positions follow you across devices.
Bookmarks are server-side for every format (page anchors for comics/PDFs, CFI
`location` anchors for EPUBs). Highlights and reader prefs live on-device.

Readers: CBZ/CBR (single/spread/webtoon, RTL manga direction, pinch-free
width-hinted pages; CBR reads locally on desktop via RAR extraction),
reflowable + fixed-layout EPUB (Readium; footnote popovers, dictionary lookup,
colored highlights), and PDF (pdf.js streaming over Range requests). All three
share chrome: scrubber, go-to-page, jump back-stack, TOC/bookmarks drawer,
themes, immersive mode.

## Development

```sh
pnpm install

# Browser-only UI dev against a local CB8 (fastest loop):
CB8_SERVER=http://localhost:4218 pnpm dev     # http://localhost:1430

# Desktop app (full native path incl. cb8:// proxy + cookie auth):
pnpm tauri dev
```

A local CB8: `cd ../server/packaging/docker && ./cb8-init.sh && docker compose up -d`
→ `http://localhost:4218`, first-boot admin password in `docker logs cb8`.

Dev server runs on port **1430** (not Tauri's usual 1420 — other Tauri
projects on this machine fight over 1420).

### Tests

```sh
pnpm test                         # frontend vector suites (vitest)
pnpm typecheck                    # tsc --noEmit
pnpm build                        # typecheck + vite build

cd src-tauri
cargo test                        # unit tests (hermetic)
cargo clippy --all-targets -- -D warnings
CB8_TEST_SERVER=http://localhost:4218 \
CB8_TEST_PASSWORD=<admin-password> cargo test --test live_server
```

The live test drives login → cookie persistence round-trip → library → page
bytes → EPUB bytes against a running server.

## Mobile

Generated projects are checked in under `src-tauri/gen/`.

Deploying a build to a physical iPad/iPhone: [DEPLOYMENT.md](DEPLOYMENT.md).

```sh
# iOS (simulator; picks/boots one):
pnpm tauri ios dev 'iPad Pro 13-inch (M5)'
# Device builds need a signing team in src-tauri/gen/apple (tauri ios build).

# Android:
export ANDROID_HOME=~/Library/Android/sdk
export NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"  # Gradle needs JDK ≤21
pnpm tauri android dev            # emulator/device
pnpm tauri android build --debug --apk --target aarch64
```

On a phone/tablet, point the connect screen at your server's LAN address
(e.g. `http://192.168.1.20:4218`). Prefer HTTPS for anything reachable from
outside your network.

Notes:
- **iOS Files / Open In:** EPUB, PDF, CBZ, and CBR are registered via
  `bundle.fileAssociations`. Opening a book from Files or the share sheet
  copies it into the owned library and opens it. On iOS the library lives under
  Documents (`UIFileSharingEnabled`) so On My iPhone → CB8 shows imports.
- **Desktop Open In / drag-and-drop:** the same `local_import` pipeline serves
  the native picker, OS file association, and drag-and-drop; every path lands
  in one importer (see [DESKTOP.md](DESKTOP.md)).
- `csp` is `null` in `tauri.conf.json`: the reader renders book chapters into
  sandboxed iframes with inline styles, which a strict CSP breaks. Book content
  never runs in the app shell — the iframe is sandboxed and Tauri's
  `__TAURI_INTERNALS__` is injected main-frame only.
- App icons were generated with `pnpm tauri icon <1024px.png>`
  (`src-tauri/icons/`, plus iOS/Android asset catalogs).
- `index.html` shims `requestAnimationFrame` with a hidden-document timeout
  fallback: the reader pumps its task queue on rAF, which browsers suppress
  while a webview is hidden — without the shim, a book opened mid-app-switch
  hangs at "Opening book…" until the next repaint.
- The dictionary popover queries `dictionaryapi.dev`; it fails soft (popover
  shows "no definition") when offline.
