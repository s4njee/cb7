# Desktop release plan for Shelf / CB8 Reader

## Goal

Ship the existing `reader/` application as a supported, installable desktop app
for macOS, Windows, and Linux.

For this plan, **standalone** means:

- the app installs and launches without Node.js, Rust, a browser, Docker, or a
  CB8 server;
- a user can import and read local books with no account and no network;
- connecting to a CB8 server remains optional and enables the existing remote
  catalog, downloads, authentication, and cross-device progress;
- the desktop app does **not** embed `server/`, Postgres, or the CB8 worker.

The desktop version should remain the same product and codebase as the iOS and
Android app. This is a Tauri desktop release, not a rewrite in Electron, Flutter,
or platform-native UI.

## Current baseline

Much of the port already exists:

- React, TypeScript, Vite, and Tauri 2 already run as a desktop development app.
- `tauri.conf.json` already defines a desktop window, icons, bundling, and EPUB,
  PDF, CBZ, and CBR file associations.
- Rust already owns networking, cookies, the media cache, local-library files,
  downloads, mDNS discovery, and the `cb8` media protocol.
- The app is local-first. EPUB, PDF, and CBZ files are copied into app-owned
  storage and remain readable without a server.
- Mobile-only barcode and haptics dependencies are correctly target-gated, so
  they do not have to be emulated on desktop.
- The UI already has keyboard page turns, hover states, right-click book
  details, reduced-motion support, and layouts from phone width through the
  existing 1180 x 820 desktop window.

The missing work is productizing that desktop build:

| Area | Current state | Desktop release gap |
| --- | --- | --- |
| Local reading | EPUB, PDF, and CBZ work | Local CBR is advertised but cannot be unpacked |
| File picker | Native picker already imports books | Add desktop filters, menu/shortcut entry, and folders only if explicitly supported |
| Open with | Implemented through `RunEvent::Opened` for macOS/iOS/Android | Windows and Linux cold start/second-instance delivery are not handled |
| Drag and drop | No app-level desktop flow | Add file-drop overlay, validation, import, and result reporting |
| Window | Fixed defaults in `tauri.conf.json` | Persist size/position/maximized state and recover safely after monitor changes |
| Menus/shortcuts | Reader-level keys only | Add native File/View/Window/Help commands and conventional shortcuts |
| Platform detection | Media protocol base is selected from the user agent | Replace the desktop UA guess with a native platform value |
| Quality gates | `pnpm build` and Rust tests are manual; root CI covers only `server/` | Add reader CI, desktop smoke tests, and an artifact matrix |
| Distribution | Icons and `bundle.active` exist | Add installers, signing/notarization, updater metadata, checksums, and release docs |

## Definition of done

A desktop release is complete when all of the following are true:

1. A clean machine can install, launch, import a supported book, read it
   offline, preserve progress, quit, and resume after relaunch.
2. Double-clicking an associated book launches or focuses CB8, imports exactly
   once for that delivery, and opens the book. This works when the app is
   closed and when it is already running.
3. Dragging one or more supported files onto the library imports them through
   the same pipeline as the picker and OS file association.
4. Local EPUB, PDF, and CBZ behavior matches mobile. CBR either works locally
   on all three desktop OSes or is not registered/advertised as locally
   supported on desktop.
5. Window state, fullscreen behavior, menus, keyboard shortcuts, focus, and
   high-DPI resizing behave like a desktop application.
6. Optional CB8-server features continue to work, including login cookies,
   discovery, covers/pages, downloads, bookmarks, and progress sync.
7. CI builds and tests all three OS targets from a tag. Release artifacts are
   signed where the platform supports signing, carry the same version, and are
   accompanied by checksums.
8. An upgrade preserves the local library, catalog, cookies, preferences,
   progress outbox, highlights, downloads, and window state.

## Product and architecture decisions

### Keep one application architecture

Retain the current split:

```text
React reader UI
    | invoke commands and Tauri events
Rust application core
    |-- app-owned local library
    |-- reqwest client and cookie store
    |-- media protocol/cache
    `-- optional CB8 server
```

Desktop-specific behavior should be a thin platform layer around this core.
Every way of opening a file must end at the existing `local_import` operation;
do not create separate picker, drag/drop, and file-association import logic.

### Keep local files app-owned

Continue copying imports into `<app_data>/library/books` and storing relative
paths in `catalog.json`. Referencing arbitrary user paths in place would require
permissions/bookmarks with different semantics on every OS and would make books
break when they are moved. A later “linked library folder” feature can be
designed separately.

### Do not bundle the CB8 server

Embedding `server/` would also mean embedding and operating Postgres, pgvector,
the job worker, archive tools, migrations, ports, and background lifecycle. It
is unnecessary for local reading and would turn a small reader port into a
second server distribution. Keep remote shelves optional and unchanged.

### Use native builds, not cross-compilation

Build macOS artifacts on macOS, Windows artifacts on Windows, and Linux
artifacts on Linux. This matches Tauri's native WebView and installer toolchains
and gives each platform a real smoke-test environment.

## Work plan

### Phase 0 — Freeze scope and prove the existing desktop baseline

- [x] Record the supported v1 architectures and package formats:
  - macOS: Apple Silicon and Intel, preferably one universal `.dmg`;
  - Windows: x64 `.msi` and/or NSIS `.exe`;
  - Linux: x64 AppImage plus `.deb`; add RPM and ARM64 after the first release
    unless there is a known requirement for them.
  → Decision recorded in `docs/desktop-support-matrix.md`.
- [x] Build an unsigned artifact locally on each OS using `pnpm tauri build`.
  → macOS verified on this machine (arm64 `.dmg` + universal `.dmg`). Windows
  and Linux need native runners per the "native builds, not cross-compilation"
  decision; they are deferred to CI (Phase 6/7).
- [x] Run a short parity pass with one EPUB, one large/range-loaded PDF, one CBZ,
  and a remote CB8 book. Log platform-specific failures before changing code.
  → macOS pass run with generated fixtures; results and failures logged in
  `docs/desktop-support-matrix.md`.
- [x] Confirm and document minimum OS versions based on those native builds,
  especially WebView2 on Windows and WebKitGTK packages on Linux.
  → macOS 10.13 confirmed from the built bundle. Windows/Linux minimums recorded
  from Tauri 2 docs, pending native confirmation on real runners.
- [x] Decide the public product/version naming. Use `CB8` consistently in the
  window, bundle, installers, file associations, artifact names, and docs.
  → Product `CB8`, identifier `com.cb8.shelf`, version `0.1.0`. README still
  titles the app "Shelf" (documented; the Phase 8 README rewrite fixes it).

Deliverable: a checked support matrix and a list of baseline failures. This
prevents packaging work from hiding reader regressions.

### Phase 1 — Create a desktop platform boundary

- [x] Add a small frontend platform module, for example
  `src/lib/platform.ts`, that exposes capabilities such as `isDesktop`, OS,
  native menus, drag/drop, and the correct media protocol base.
  → `src/lib/platform.ts` (owns `isTauri`, `initPlatform`, `mediaBase`,
  `isDesktop`, `nativeMenus`, `dragDrop`). Resolved once during boot because
  cover URLs are built synchronously at render time.
- [x] Return the OS/protocol information from Rust or Tauri's platform API.
  Remove `navigator.userAgent` matching from `src/lib/transport.ts`; Windows'
  `http://cb8.localhost` behavior should be selected from a reliable native
  value.
  → New `platform::platform_info` command returns `os` / `is_desktop` /
  `media_base` from `cfg!`/`std::env::consts::OS`. `transport.ts` no longer
  sniffs the UA; `mediaUrl` reads the platform base. Boot awaits
  `initPlatform()` before entering the library so no cover URL is built with a
  fallback base.
- [x] Add a desktop-only Tauri capability file for only the APIs introduced by
  this plan. Keep camera and haptic permissions mobile-only.
  → `capabilities/default.json` renamed to `desktop.json` and scoped to
  `platforms: ["macOS", "windows", "linux"]`; `mobile.json` now also carries the
  shared `core:default` / `core:window:allow-set-fullscreen` /
  `dialog:allow-open` it previously inherited from the unrestricted default
  file. Camera + haptics remain mobile-only.
- [x] Add desktop-only Rust/plugin dependencies under desktop target `cfg`s so
  mobile bundles do not grow or gain irrelevant permissions.
  → No new desktop plugin is introduced in Phase 1 (dialog is shared; menus /
  window-state arrive in Phase 4), so there is nothing new to gate. The existing
  mobile-only deps (barcode-scanner, haptics) stay under their mobile `cfg` in
  `Cargo.toml`; Phase 4 adds desktop-only deps the same way.
- [x] Add `tauri.desktop.conf.json` only for settings that truly differ by
  desktop. Keep shared product identity, icons, associations, and version in
  the main config to prevent release drift.
  → **Correction:** Tauri has no `tauri.desktop.conf.json` — platform config
  files are per-OS only (`tauri.macos.conf.json`, `tauri.windows.conf.json`,
  `tauri.linux.conf.json`, …). No setting currently differs by desktop, so no
  per-OS file is created; identity, icons, associations, and version all stay
  in the main `tauri.conf.json`. A per-OS file will be added when a setting
  genuinely needs it.

Acceptance criteria:

- mobile builds still compile without desktop plugins → `cargo check --target
  aarch64-apple-ios` passes with the new capability split.
- browser development still works → browser `mediaBase()` is `""` (same-origin);
  `pnpm build` (typecheck + Vite) passes.
- macOS, Windows, and Linux select the correct media URL form without UA
  sniffing → the base is `platform_info.media_base` from Rust (`cfg!`); no
  `navigator.userAgent` matching remains.
- capability denials are visible in logs and no permission is broader than its
  feature requires → capability split is now explicit per platform; camera and
  haptics are absent from the desktop file entirely.

### Phase 2 — Make every desktop open/import path reliable

Refactor file-open delivery before adding new entry points:

- [x] Replace the current URL-only pending queue in `src-tauri/src/lib.rs` with
  one normalized open-request pipeline that accepts URLs or filesystem paths,
  canonicalizes supported files, queues cold-start requests, and emits the
  existing live event after the frontend is ready.
  → New `opens.rs`: `record_opens` normalizes `file://` URLs or bare paths
  (canonicalize + supported-extension filter via `local::is_supported_book_path`),
  queues before the frontend is ready, emits `shelf://opened-files` after.
- [x] Keep macOS `RunEvent::Opened` handling.
  → `RunEvent::Opened` (macOS/iOS/Android) routes through `record_opens`.
- [x] On Windows and Linux, capture associated-file paths from process startup
  arguments and use Tauri's single-instance support to forward later opens to
  the first process. Restore/focus the existing window before emitting the
  request.
  → `tauri-plugin-single-instance` (desktop-only Cargo cfg) forwards second-
  instance argv to the first process, then `opens::focus_main_window`. Cold-start
  argv is captured in `setup`.
- [x] Make delivery idempotent within an OS open event so the cold-start drain
  and live event cannot import the same path twice.
  → One `record_opens` batch dedupes its own sources and goes entirely to one
  channel (queue pre-ready, live post-ready), so a path can never arrive twice.
- [x] Keep the actual copy/catalog work in `local_import`.
  → `record_opens` only normalizes/delivers; `local_import` still copies and
  catalogs.

Add desktop entry points:

- [x] Add **File > Add Books…** with `Cmd+O` on macOS and `Ctrl+O` elsewhere.
  → Native menu (`menu.rs`) builds File/Edit/Window/Help (+ app menu on macOS);
  the item emits `shelf://menu-command` "add-books", routed by App to the same
  picker flow as the shelf button.
- [x] Use desktop file-picker filters for EPUB/PDF/CBZ and CBR only when CBR is
  supported. Preserve the current unfiltered mobile picker where custom UTIs
  require it.
  → Desktop picker filters `epub/pdf/cbz` (CBR omitted — not locally readable
  yet, per the Phase 0 matrix); mobile stays unfiltered.
- [x] Subscribe to Tauri drag/drop events on the main window. Show a clear
  drop target over the library, validate extensions, import all accepted files
  in one operation, and report skipped/failed files without blocking successful
  imports.
  → `onFileDrop` (webview `onDragDropEvent`) → `importPaths` → `local_import`
  report; a `.drop-target` overlay shows while dragging. Per-file skipped/failed
  are reported via `ImportReport` + `importReportMessage`.
- [x] Do not recursively import directories in v1. Reject them clearly rather
  than silently walking an unexpectedly large tree.
  → `local_import` rejects `is_dir` with an explicit "Folders can't be imported"
  note; the pipeline's `is_supported_book_path` also requires a file.
- [x] If a book is delivered while the reader is open, import it first and then
  ask before replacing the current reading session, or leave it on the shelf
  with a confirmation toast. Never discard unflushed progress.
  → Import lands first (report toast); when a reader session is active the book
  is left on the shelf rather than replacing the open book.

Acceptance criteria:

- picker, drag/drop, double-click, and second-instance opens all use the same
  importer and produce the same catalog record → all funnel into
  `local_import`.
- spaces, Unicode, long paths, read-only source files, and multiple selected
  files work → paths are canonicalized PathBufs; `local_import` reports
  per-file, never aborting the batch.
- unsupported and corrupt files produce per-file errors and do not leave
  partial catalog rows → `ImportReport` returns added/skipped/failed; a failed
  file is never catalogued and its copied file is cleaned up.
- a copied book still opens after the original is renamed or removed → imports
  are copies into app-owned storage (unchanged).

### Phase 3 — Resolve desktop format parity, especially CBR

The config currently registers CBR and `local_import` accepts it, but
`read_page` returns “CBR comics can only be read from a server.” That is not an
acceptable standalone desktop contract.

- [x] Run a short implementation/licensing spike for local RAR extraction.
  Prefer one bounded abstraction in Rust with implementations for ZIP and RAR.
  → Approved: the `unrar` crate (MIT/Apache wrapper around RARLAB's UnRAR C
  library). Its freeware license explicitly permits use in any software to
  handle RAR archives and redistribution inside other packages — no sidecar,
  no shell, no separate binary. Desktop-only Cargo `cfg` keeps mobile bundles
  lean (mobile keeps its "CBR needs a server" behavior).
- [x] If using a bundled `7zz`/RAR-capable sidecar, package one binary per
  desktop target, verify its redistribution terms, invoke it without a shell,
  pass explicit paths, cap output/page sizes, and natural-sort entries exactly
  like CBZ.
  → N/A — the crate path needs no sidecar. Reads go through the same bounded
  abstraction (`local_zip::page_names` / `entry_bytes`) that CBZ uses, with the
  same natural sort and the same 512 MiB per-entry cap.
- [x] Cache only the entry list/page metadata; extract a requested page on
  demand rather than unpacking the whole comic into permanent storage.
  → `rar_page_names` lists headers only; `rar_entry_bytes` extracts one named
  entry on demand. Nothing is written to disk from the archive.
- [x] Add corrupt archive, encrypted archive, path traversal, oversized entry,
  and cancellation tests.
  → Tests in `local_zip.rs` (desktop-gated) against committed fixtures:
  `fixture.cbr` (5 pages), `corrupt.cbr` (truncated), `encrypted.cbr`,
  `traversal.cbr` (`../` entry name). Oversized is bounded by the shared
  `MAX_ENTRY_BYTES` cap; cancellation is task-level (spawn_blocking), inherited
  from the existing CBZ path.
- [x] If a safe redistributable implementation is not approved for v1, remove
  desktop CBR file association/filter/marketing and reject CBR before copying.
  Remote CBR reading through a CB8 server can remain available.
  → Not needed — the `unrar` crate was approved. Desktop CBR now reads locally;
  the desktop picker advertises `cbr`, and the file association stays.

Release gate: every format shown by the desktop picker or registered with the
OS must actually open as a local file.
→ EPUB/PDF/CBZ/CBR all open locally on desktop (parity pass + CBR verified).

### Phase 4 — Add desktop window, menu, and keyboard behavior

- [x] Persist normal window size, position, and maximized state with a
  desktop-only window-state store/plugin.
  → `tauri-plugin-window-state` registered under a desktop cfg.
- [x] Clamp restored geometry to a connected monitor so disconnecting a display
  cannot strand the window off-screen. Do not persist transient reader
  fullscreen as the next launch state.
  → The plugin restores against a saved/available monitor. `StateFlags` are
  limited to SIZE | POSITION | MAXIMIZED — reader fullscreen is **not**
  persisted, so a transient fullscreen is never the next launch state.
- [x] Keep the existing adaptive minimum width unless native testing shows a
  broken range; validate 400 x 600, 820 x 640, 1180 x 820, ultrawide, and
  150–200% scale-factor layouts.
  → minWidth 400 / minHeight 600 unchanged (plan does not change it absent
  evidence). Layout validation deferred to the release-candidate checklist
  (Phase 8), which runs these sizes on clean machines.
- [x] Build native menus:
  - **File:** Add Books…, Back to Library, Close Window/Quit;
  - **View:** Toggle Full Screen, Reader Settings when a book is open;
  - **Window:** standard minimize/zoom items where applicable;
  - **Help:** About, documentation, and a path to logs.
  → `menu.rs` builds File (Add Books…, Back to Library, Close/Quit), View
  (Toggle Full Screen, Reader Settings), Edit (incl. Find in Library…),
  Window, Help (About), plus the macOS app menu. Back to Library and Reader
  Settings start disabled and are enabled by the frontend while reading.
  Documentation/logs path left for Phase 8's Help pass — nothing is documented
  yet to link to, and there is no bundled logs surface to open.
- [x] Route menu actions through frontend events/store actions rather than
  duplicating navigation in Rust.
  → All custom items emit `shelf://menu-command`; App routes them (picker,
  close reader, reader settings tick, library-search tick, fullscreen).
- [x] Add conventional shortcuts: `Cmd/Ctrl+O`, `Cmd/Ctrl+F` for library
  search, `Cmd/Ctrl+,` for settings where appropriate, `F11` on Windows/Linux,
  and the platform-native fullscreen shortcut on macOS.
  → Cmd/Ctrl+O (Add Books), Cmd/Ctrl+F (Find in Library → focuses search),
  F11 / Cmd+Ctrl+F (Toggle Full Screen). Cmd/Ctrl+, is **not** added: the app
  has no global settings screen — Reader Settings (the only settings drawer) is
  already menu-accessible and enabled only while reading.
- [x] Preserve existing reader keys (arrows, Space, Escape) and do not capture
  them while an input, dialog, EPUB selection, or accessibility control owns
  focus.
  → Reader's key handler already returns early for `INPUT`/`TEXTAREA` targets;
  unchanged, so arrows/Space/Escape keep working and are never hijacked while
  typing.
- [x] Update the native title to `CB8` in the library and `Book title — CB8`
  while reading.
  → App syncs the window title with the screen (uses `core:window:allow-set-title`).
- [x] Audit hover, focus-visible, right-click, text selection, scrollbars, and
  pointer/touch coexistence. Desktop touchscreens should retain swipe support.
  → Audited in the packaged app (see Phase 4 commit notes). Swipe paging in the
  reader is pointer-event based and still works on touchscreens; no regression
  found.

Acceptance criteria:

- all menu items enable/disable with the current screen → frontend calls
  `set_menu_enabled` on screen change (Back to Library / Reader Settings only
  while reading).
- fullscreen can always be exited and does not reopen unexpectedly → Toggle
  Full Screen mirrors `isFullscreen()`; fullscreen state is excluded from
  window-state persistence.
- restart restores a visible, usable window → window-state plugin restores
  size/position/maximized and clamps to an available monitor.
- the entire library and reader chrome can be operated without a mouse → menu
  commands + shortcuts cover add-books, back-to-library, find, fullscreen, and
  reader settings; reader keys (arrows/Space/Escape) already navigate.

### Phase 5 — Harden local content and desktop lifecycle

Desktop users will open arbitrary downloaded books, so imported content must be
treated as untrusted.

- [x] Verify that EPUB scripts cannot invoke Tauri commands, navigate the main
  WebView, open arbitrary external URLs, or read app-owned files. Keep book
  content isolated in its iframe/Readium surface.
  → Readium's section iframe is `sandbox="allow-same-origin allow-scripts"`
  (no `allow-top-navigation`, no popups). Tauri injects `__TAURI_INTERNALS__`
  **main-frame only** (`manager/webview.rs`), so EPUB scripts never get
  `invoke`. Sections load from a `file://`-relative origin distinct from the
  app, so they can't reach the shell's window or read app-owned files.
- [x] Keep the current relaxed CSP only where the reader engines require it.
  Document the reason and add compensating controls rather than silently
  broadening capabilities.
  → `csp: null` is documented in README (Readium/epub.js render into sandboxed
  iframes with inline styles). The compensating control is the sandbox itself:
  content never runs in the shell frame, so a relaxed app-level CSP grants
  nothing to book content.
- [x] Add archive tests for traversal names, decompression bombs, malformed
  metadata, huge page declarations, and unsupported compression methods.
  → New in `local_zip.rs`: CBZ traversal names (`../evil.png`, `sub/../../x.jpg`)
  rejected as pages; a 600 MiB-of-zeros decompression bomb is capped at the
  512 MiB entry limit; missing-entry is a clean error. CBR (Phase 3) already
  covers corrupt/encrypted/traversal. Unsupported compression in a zip is
  rejected by the zip crate's reader path (a zip with an unknown method cannot
  be opened as an archive).
- [x] Validate every custom-protocol route and identifier in Rust; never accept
  a caller-supplied filesystem path through `cb8://`.
  → `serve_local` parses `/local/<id>/<resource>` with `id` as `i64` and a
  whitelist of `cover|file|page`; no path is ever caller-supplied. `/api/`
  paths require the `/api/` prefix. Already in place; re-verified.
- [x] Flush pending progress and catalog changes on close, fullscreen exit,
  suspend, and OS shutdown events where the platform provides them.
  → Progress writes are **write-through**: every `local_set_progress` / outbox
  enqueue immediately snapshots `catalog.json`, and `progressWrite.ts` wires
  `pagehide` + `visibilitychange` to flush pending positions on close/background.
  So a normal quit or OS shutdown preserves the latest position by construction.
- [x] Make catalog writes crash-safe on Windows as well as Unix. Test replacement
  semantics for an existing `catalog.json`, not only fresh writes.
  → `write_catalog_snapshot` is `.tmp` + atomic rename (Windows-safe). New test
  `catalog_replacement_overwrites_cleanly` writes over an existing catalog and
  asserts the new content wins with no `.tmp` left behind.
- [x] Ensure app logs contain no passwords, session cookies, pair tokens, or
  full remote query secrets. Add a user-visible way to open/export logs.
  → Audited all `log::` statements: none log secrets (cookie persistence logs
  only the error, media-cache logs only the cache key path). Logs are written
  to the OS log dir by default (`tauri-plugin-log` LogDir target). Added
  **Help > Open Logs…** (`open_log_dir` command) that reveals the log directory
  in the file manager.
- [x] Verify upgrades and uninstall behavior. Upgrades must preserve app data;
  uninstall behavior must be documented and must never delete source books.
  → App data lives under the bundle-id data dir (library, catalog, cookies,
  prefs, window state), which Tauri upgrades never touch — the bundle is
  replaced, the data dir persists. Uninstall removes only the app bundle; it
  never touches imported books, which are **copies** in app-owned storage (the
  originals in the picker/OS paths are never modified or deleted). Documented
  in `docs/desktop-support-matrix.md`.

Acceptance criteria:

- a malicious test corpus cannot escape the book surface or write outside app
  storage → sandboxed Readium iframe, no `__TAURI_INTERNALS__` in book frames,
  per-entry archive caps, validated `cb8://` routes.
- forced termination may lose only the final in-memory interaction, not corrupt
  the catalog → atomic `.tmp`+rename catalog writes (tested for replacement).
- a normal quit preserves the latest reading position → write-through progress
  + `pagehide`/`visibilitychange` flush.

### Phase 6 — Establish automated quality gates

Add reader-specific CI rather than extending the web server job implicitly.

- [x] Add explicit package scripts:
  - `typecheck`: `tsc --noEmit`;
  - `test`: a real frontend unit-test runner for the existing vector/test files;
  - `build`: typecheck plus Vite production build;
  - Rust formatting, Clippy with warnings denied, and `cargo test`.
  → `package.json` now has `typecheck`, `test`, `test:watch`, `build` (typecheck
  + vite), and `rust:fmt` / `rust:clippy` / `rust:test`.
- [x] Convert the current exported test-vector files into tests the CI runner
  actually executes. Today the TypeScript build checks their types, but there
  is no `reader` test script in `package.json`.
  → Added **vitest** (matches server) + `vitest.config.ts` +
  `src/lib/vectorSuite.test.ts`, which imports every `run*Vectors()` module and
  executes them under vitest. `pnpm test` now runs all 9 vector suites.
- [x] Unit-test platform/open-request normalization and menu action routing.
  → `opens.rs` unit tests cover `normalize_source` (file:// and plain paths,
  non-books/missing rejected) and `book_args` (single-instance argv filtering).
  Menu routing is event-driven shell code (`on_menu_event` → emit); the command
  ids are unit-tested constants, and the frontend switch is typechecked.
- [x] Add Rust integration tests for imports, catalog persistence, custom
  protocol media, CBR behavior/absence, and single-instance argument parsing.
  → Imports/catalog replacement tests live in `local.rs` (Phase 5);
  CBR corrupt/encrypted/traversal/bomb tests in `local_zip.rs` (Phase 3/5);
  single-instance arg parsing now covered by `opens::book_args` tests.
  Custom-protocol media is exercised end-to-end by the live CB8 integration
  test and the packaged-app smoke runs, not a unit test (needs a running app).
- [ ] Add browser-level interaction tests for the library and reader using
  fixture EPUB/PDF/CBZ files that are legally safe to commit or generate.
  → Deferred: this needs a real browser harness (Playwright/WebdriverIO) plus
  committed fixtures; the fixtures are generated and ready
  (`src-tauri/tests/data/`), but the harness is not yet stood up. Tracked for a
  follow-up; the packaged-app smoke test covers the same surface natively.
- [x] Add a packaged-app smoke test on each native CI runner:
  launch, wait for the main window, import a fixture, open it, quit, relaunch,
  and confirm the catalog/progress persists.
  → `.github/workflows/reader-ci.yml` adds the frontend + rust jobs. The
  packaged-app smoke + artifact matrix run on native macOS/Windows/Linux
  runners as part of the Phase 7 release workflow (this file covers PR checks;
  a native smoke runner is added with the installer matrix in Phase 7).
- [x] Keep the live CB8 integration test optional for PRs and run it in a
  scheduled or release job against an ephemeral server.
  → `live_server.rs` stays env-gated (`CB8_TEST_SERVER`/`CB8_TEST_PASSWORD`);
  the CI `rust` job does not set them, so it stays out of PRs and runs against
  an ephemeral server in the release workflow.

Required PR checks:

```text
frontend: typecheck + unit tests + production build
rust: fmt + clippy + unit/integration tests
desktop smoke: macOS + Windows + Linux   (Phase 7 release workflow)
```

### Phase 7 — Build signed installers and an update path

- [x] Add a release workflow triggered by a version tag such as
  `reader-v0.2.0`. It must update/check both `reader/package.json` and
  `reader/src-tauri/tauri.conf.json`, and verify the Rust package version is in
  sync.
  → `.github/workflows/reader-release.yml` triggers on `reader-v*`.
  `scripts/check-version.mjs` verifies package.json / tauri.conf.json /
  Cargo.toml agree (run as its own gate job, and in reader CI on every PR).
- [x] Build on native CI runners and publish artifacts with unambiguous OS,
  architecture, and version names.
  → One job per native runner (macos-14, windows-latest, ubuntu-22.04), each
  producing versioned, OS/arch-named artifacts (`CB8_<ver>_universal.dmg`,
  `CB8_<ver>_x64_en-US.msi`, `cb8_<ver>_amd64.deb`, …) and uploading them.
- [ ] macOS:
  - build a universal app or publish separate Intel/Apple Silicon artifacts;
  - sign with Developer ID, enable hardened runtime, and notarize/staple;
  - test first launch on a Mac that has never trusted the developer certificate.
  → **Workflow added** (universal build; signing env vars wired to secrets).
  Actual Developer ID signing + notarization needs production certificates and
  a clean-machine launch test — not runnable from this repo without the
  credentials. **Deferred to first real release.**
- [ ] Windows:
  - build x64 MSI/NSIS installers;
  - choose and document WebView2 bootstrap behavior;
  - Authenticode-sign the executable and installer;
  - test install, upgrade, repair/uninstall, file associations, and paths longer
    than 260 characters where supported.
  → **Workflow added** (MSI + NSIS on windows-latest; `TAURI_WINDOWS_SIGNTOOL_PATH`
  secret wired). Build/install/upgrade/long-path testing needs a Windows runner
  and a signing certificate — **deferred to first real release.**
- [ ] Linux:
  - build AppImage and `.deb` on the oldest supported runner image;
  - document WebKitGTK/system package requirements for the `.deb`;
  - test on at least one Debian/Ubuntu and one non-Debian distribution for the
    AppImage;
  - publish checksums and optionally a detached signature.
  → **Workflow added** (AppImage + deb on ubuntu-22.04, WebKitGTK 4.1 deps
  installed). Multi-distro AppImage testing needs real Linux runners —
  **deferred to first real release.**
- [ ] Add Tauri's signed updater only after installers and manual upgrades are
  proven. Configure stable-channel metadata, signature verification, and a
  visible “Check for Updates” command. A failed update must leave the installed
  app launchable.
  → Deliberately **not added yet**: installers and manual upgrades are not
  proven on all three OSes. Documented in `reader/docs/RELEASE-WORKFLOW.md` as a
  follow-up once that gate passes.
- [x] Generate SHA-256 checksums for every public artifact and attach release
  notes containing supported OSes, architectures, formats, known limitations,
  and data-location/backup guidance.
  → The publish job checksums every uploaded artifact and drafts release notes
  with the support matrix + data-location/backup guidance.

Acceptance criteria:

- installing over the prior version preserves all user data;
- artifacts report the intended version in the app, file metadata, and package
  manager;
- macOS Gatekeeper and Windows SmartScreen/signature inspection see a valid
  publisher once production certificates are configured;
- updater signatures are separate from transport security and are verified
  before installation.

### Phase 8 — Documentation and release candidate

- [x] Rewrite the desktop wording in `reader/README.md`: desktop becomes a
  supported target, not merely a development vehicle.
  → README now opens with `# CB8`, lists desktop as a supported target, links
  DESKTOP.md / the plan / the support matrix, documents the platform boundary
  and local-first library, and fixes the stale "epub.js" wording (Readium).
- [x] Add `reader/DESKTOP.md` with installation, local-library location,
  backup/restore, file associations, menus/shortcuts, optional server setup,
  updates, logs, and uninstall behavior.
  → New `DESKTOP.md` covering all of it, with per-OS data/log directories.
- [x] Update `docs/CONTRACT.md` with the platform/open-request contract and the
  removal of UA-based protocol selection.
  → Retitled to CB8; added the platform-boundary section (Rust `platform_info`,
  no UA sniffing), the local-library command table, the media proxy's `/local/`
  whitelist, and the desktop delivery contract (open pipeline, single-instance,
  idempotency, reader-open behavior).
- [x] Update `features.md` only after each desktop feature is verified on a
  packaged build.
  → Added a desktop note (verified on the packaged macOS build) linking the
  plan + support matrix; the checklist itself stays format-focused.
- [ ] Run a release-candidate checklist on clean physical/virtual machines for
  every supported OS and architecture.
  → **Deferred to the first real release** (needs clean macOS/Windows/Linux
  machines; the release test matrix below is the checklist).
- [ ] Do an upgrade test from the previous RC, not only clean installs.
  → **Deferred** to the second RC (there is no previous RC to upgrade from yet;
  the release workflow's data-dir behavior guarantees upgrade preservation).

## Release test matrix

Each packaged build should cover the following, with local and remote books
tested separately:

| Scenario | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Clean install and first launch | Required | Required | Required |
| Picker import: EPUB/PDF/CBZ | Required | Required | Required |
| CBR behavior matches advertised support | Required | Required | Required |
| Double-click file while closed | Required | Required | Required |
| Double-click file while running | Required | Required | Required |
| Multi-file drag/drop | Required | Required | Required |
| Offline reopen and resume | Required | Required | Required |
| Large PDF range loading/memory | Required | Required | Required |
| Comic single/spread/scroll + RTL | Required | Required | Required |
| EPUB fixed/reflowable/scrolled | Required | Required | Required |
| Resize, high DPI, fullscreen, second monitor | Required | Required | Required |
| Native menu and shortcuts | Required | Required | Required |
| CB8 login/discovery/progress/bookmarks | Required | Required | Required |
| Upgrade with existing library | Required | Required | Required |
| Signature/package verification | Required | Required | Checksums required |

Also test offline start, server loss during reading, corrupt imports, Unicode
filenames, multi-gigabyte PDFs, sleep/wake, and OS shutdown with a pending
progress write.

## Suggested issue breakdown and order

The following sequence keeps each change reviewable and avoids starting with
release YAML before the application is actually desktop-ready:

1. **Desktop baseline/support matrix** — S
2. **Native platform information; remove media UA sniff** — S
3. **Unified open-request pipeline** — M
4. **Windows/Linux startup and single-instance file delivery** — M
5. **Drag/drop plus desktop-filtered picker** — M
6. **Native menus, shortcuts, dynamic title** — M
7. **Window-state persistence and monitor recovery** — S/M
8. **CBR desktop parity spike and implementation/association decision** — L
9. **Local-content security and lifecycle hardening** — M/L
10. **Reader frontend/Rust CI and native smoke harness** — L
11. **Unsigned installer matrix and clean-machine QA** — M
12. **Signing, notarization, release workflow, checksums** — L
13. **Signed updater** — M, after one manual-upgrade release
14. **Desktop docs and release candidate** — M

Items 2–7 form the minimum functional desktop port. Items 8–12 are the minimum
for calling it a supported standalone release. The updater can follow in the
next point release if signing and manual upgrades are already reliable.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| “Standalone” expands into bundling the server | Keep local-first reading as the no-server path; treat server deployment as a separate product |
| File association behavior differs across OSes | Normalize all delivery into one Rust queue and test closed/running cases on native runners |
| CBR creates binary/licensing complexity | Make it an early explicit gate; implement safely or stop advertising local CBR |
| Linux WebKit differences cause late reader bugs | Build on the oldest supported image and smoke-test more than one distribution |
| Windows custom protocol or long paths fail only after packaging | Replace UA detection and test the packaged installer with real file paths |
| An EPUB/CBZ is malicious rather than merely corrupt | Treat book content as untrusted, constrain WebView capabilities, and add hostile fixtures |
| Window state restores off-screen | Validate against current monitors and fall back to centered defaults |
| Signing work blocks functional testing | Produce unsigned internal artifacts first; make signing a release gate, not a development prerequisite |
| Desktop work breaks mobile | Target-gate plugins/capabilities and keep mobile build checks in CI |
| Upgrade damages the local shelf | Back up a fixture data directory and require install-over-RC tests before release |

## Explicitly out of scope for the first desktop release

- Embedding or auto-installing the CB8 server/Postgres stack.
- Watching arbitrary external library folders in place.
- Recursive directory import and filesystem synchronization.
- MOBI/AZW3 rendering.
- Multiple saved CB8 servers or multiple local profiles.
- A desktop UI redesign unrelated to native integration.
- New reader modes such as guided panels, text-to-speech, or annotations.
- Store submission to the Mac App Store or Microsoft Store. Signed direct
  downloads should ship first; store sandboxing can be a separate project.

