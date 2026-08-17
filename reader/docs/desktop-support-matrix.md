# Desktop support matrix — Phase 0 baseline

Result of the Phase 0 freeze (2026-08-16): recorded architectures, built and
verified an unsigned macOS artifact, ran a parity pass on macOS, recorded
minimum OS versions, and pinned product naming. This is the baseline the rest of
`plan-desktop.md` builds on; failures here are the ones to fix before packaging.

## Supported v1 architectures and package formats

| Platform | Architectures | Formats | Notes |
| --- | --- | --- | --- |
| macOS | Apple Silicon + Intel | one universal `.dmg` | Universal binary confirmed working (`CB8_0.1.0_universal.dmg`); per-arch `.dmg` also possible. |
| Windows | x64 | `.msi` (WiX) and/or NSIS `.exe` | MSI preferred for reliable file-association registration (open Tauri issue #9803; see risks). |
| Linux | x64 | AppImage + `.deb` | RPM and ARM64 deferred to after the first release unless a requirement appears. |

Deferred to later releases: Linux RPM, Linux ARM64, any other per-arch artifact.

## Minimum OS versions

| Platform | Minimum | Basis |
| --- | --- | --- |
| macOS | 10.13 (High Sierra) | `LSMinimumSystemVersion = 10.13` read from the built `CB8.app` Info.plist (Tauri default). |
| Windows | Windows 10 1803+ effectively; Windows 7 possible with caveats | WebView2 Runtime is preinstalled on Win10 1803+/11. Tauri default `webviewInstallMode = downloadBootstrapper` (needs internet at install). For Win7 or offline installs, choose `embedBootstrapper` / `offlineInstaller`. **To confirm on a real runner.** |
| Linux | Ubuntu 22.04 / Debian 12 class (glibc + webkit2gtk-4.1) | Tauri 2 requires **webkit2gtk-4.1** (not 4.0). Runtime deps: `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libappindicator3-1` (tray). **To confirm on a real runner.** |

The Windows/Linux rows are recorded from Tauri 2 documentation and are pending
confirmation on native runners (Phase 6/7). macOS was confirmed directly from a
native build on this machine.

## Product and version naming

| Attribute | Value |
| --- | --- |
| Product name | `CB8` (window title, `productName`, `index.html` title, binary name) |
| Bundle identifier | `com.cb8.shelf` (also `com.cb8.shelf.cbz` / `.cbr` for comic UTIs) |
| Version | `0.1.0` (in `package.json`, `tauri.conf.json`, and `Cargo.toml` — in sync) |
| Category | `Entertainment` (was `Book`, which Tauri's bundler rejects) |

**Decision:** the public product name is `CB8`, version `0.1.0`. Use `CB8`
consistently in the window, bundle, installers, file associations, artifact
names, and docs.

**Residual naming gap:** `reader/README.md` still opens with `# Shelf`, and the
desktop section calls the desktop build the "development vehicle." Both are
documented here and corrected by the Phase 8 README rewrite. No code or config
uses "Shelf" as a product name; the only other "Shelf" references are prose and
internal variable names, which are fine.

## Parity pass — macOS (2026-08-16)

Ran the packaged `CB8.app` (unsigned, built with `pnpm tauri build`), connected
to a live local CB8 server, and drove all four import/read paths with generated
fixtures (original content, safe to commit later).

| Format | Fixture | Result | Evidence |
| --- | --- | --- | --- |
| EPUB | `fixture.epub` (2 chapters, original) | ✅ imports + renders reflowable text | Readium progress recorded: `location: {"href":"ch1.xhtml",…}` in `catalog.json`; on-screen "Chapter One". |
| PDF (large, range-loaded) | `fixture-large.pdf` (200 pages) | ✅ imports + pdf.js renders page 1 of 200 | Catalog record + on-screen "Fixture page 1 of 200". |
| CBZ | `fixture.cbz` (12 image pages) | ✅ imports + cover extracted + comic reader renders | `pageCount: 12`, cover extracted to `covers/…png`; on-screen "PAGE 1". |
| Remote CB8 book | comic + book on live server | ✅ login → library → page bytes → EPUB bytes | `cargo test --test live_server` passes against `localhost:4218`. |

Also verified: quit and cold relaunch preserve the local library (3 books
present after relaunch). Local books are copied into app-owned storage
(`<app_data>/library/books`), so they remain readable when the original is gone.

## Baseline failures and gaps (macOS)

These are the Phase 0 findings. None are reader regressions; they are packaging
or environment issues that must be fixed (or consciously carried) before a
release.

1. **`bundle.category: "Book"` breaks `tauri build`.** Tauri's bundler has no
   `Book` category; the whole build failed with `invalid category` after a 70 s
   compile. **Fixed** in `tauri.conf.json` → `"Entertainment"`. Rebuild clean.
2. **Local CBR is advertised but cannot be read.** `tauri.conf.json` registers
   `.cbr` file association, and `local_import` accepts CBR, but `read_page`
   returns *"CBR comics can only be read from a server — CB8 can't unpack RAR on
   device."* This violated the plan's release gate. **Fixed in Phase 3** by
   adding local RAR extraction via the `unrar` crate (desktop-only): CBR now
   lists and reads pages through the same bounded abstraction as CBZ, and the
   desktop picker advertises `cbr`. Remote-only is gone on desktop.
3. **Server-side data loss in the local dev docker stack.** All pre-existing
   comic files were missing from `/var/lib/cb8/web-uploads` (records existed in
   Postgres but the files were gone), so every `pages/0` returned 500. This is
   an environment/data issue, not a reader bug. Two fixture records were
   uploaded to the dev server to make the remote leg testable; they can be
   removed.
4. **Rust dead-code warnings (3).** `save` in `local.rs` and
   `migrate_library_if_needed` / `copy_dir_recursive` in `state.rs` are
   `#[cfg(not(test))]`-unused on desktop. Harmless, but Phase 6's
   "clippy with warnings denied" will need them addressed.
5. **Windows/Linux builds not runnable from this macOS machine.** Per the
   plan's "native builds, not cross-compilation" decision, those artifacts and
   their smoke tests are deferred to native CI runners (Phase 6/7).
6. **`pnpm` ignores `pnpm.onlyBuiltDependencies`.** Newer pnpm wants this in
   `pnpm-workspace.yaml` / config; the build still works (esbuild postinstall
   already ran). Cosmetic warning; fix alongside Phase 6 package-script work.

## Data, upgrade, and uninstall behavior

- **App data** lives under the bundle-id data directory: local library
  (`library/`), catalog, cookies, prefs, and window state. It is never inside
  the app bundle.
- **Upgrades** replace the app bundle; the data directory is untouched, so the
  library, catalog, cookies, prefs, progress, downloads, and window state all
  survive.
- **Uninstall** removes the app bundle (and on macOS, optionally the data
  directory via the system). Imported books are **copies** in app-owned
  storage — the original files you picked or opened are never modified or
  deleted by the app, and uninstalling never touches them.
- Logs are written to the OS log directory (`tauri-plugin-log` default) and can
  be opened from the app via **Help > Open Logs…**.

## Notes for the next phases

- The `.dmg` and `.app` are **ad-hoc / linker-signed**, not Developer ID — the
  expected unsigned baseline. Signing/notarization is Phase 7.
- File associations are registered in the built Info.plist for EPUB/PDF/CBZ/CBR
  (macOS `CFBundleDocumentTypes` + `UTExportedTypeDeclarations`). macOS works;
  Windows MSI-vs-NSIS association reliability is an open Tauri issue (#9803) to
  validate on a real Windows runner.
- The updater is a separate plugin (`tauri-plugin-updater`), not present today.
  Windows/macOS artifacts for it are NSIS/MSI and `.app.tar.gz` respectively —
  the DMG is not the updater artifact. Relevant when Phase 7 lands.
