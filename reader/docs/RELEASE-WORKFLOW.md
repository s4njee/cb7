# Reader desktop release workflow

How a `reader-vX.Y.Z` tag becomes signed installers and a GitHub release.

> **Status: scaffolding.** The workflow below is written but signing secrets are
> not configured, and Windows/Linux runners have not been proven end-to-end.
> The first release should be **unsigned** on macOS to validate the pipeline
> before introducing signing (the plan's own sequencing: unsigned artifacts
> first, signing as a release gate). The updater is deliberately not added until
> installers and manual upgrades are proven.

## Trigger

Push a tag of the form `reader-v0.2.0`. The version must match **all three**
sources (checked by `scripts/check-version.mjs` before any build):

- `reader/package.json`
- `reader/src-tauri/tauri.conf.json`
- `reader/src-tauri/Cargo.toml`

## Artifacts

Each native runner builds with `pnpm tauri build --bundles ...` and uploads
unambiguously named artifacts:

| Runner | Artifacts |
| --- | --- |
| macos-14 (arm64 + x86_64) | `CB8_<ver>_universal.dmg`, `CB8_<ver>_universal.app.tar.gz` |
| windows-latest | `CB8_<ver>_x64_en-US.msi`, `CB8_<ver>_x64-setup.exe` (NSIS) |
| ubuntu-22.04 | `cb8_<ver>_amd64.deb`, `CB8_<ver>_x86_64.AppImage` |

Every artifact is accompanied by a `.sha256` checksum, and the release body
lists them all with the support matrix and data-location guidance.

## Signing (configured via repo secrets)

- **macOS**: `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` for Developer ID
  signing + notarization + stapling. Without them the job still builds and
  uploads an ad-hoc-signed artifact (with a warning in the release body that it
  is not notarized).
- **Windows**: `TAURI_WINDOWS_SIGNTOOL_PATH` + the certificate in the repo
  secret, or sign the artifacts in a follow-up step. Without them, MSI/NSIS
  upload unsigned.
- **Linux**: no code signing; AppImage/`.deb` are checksummed only.

## The updater

Not wired up yet, on purpose. The plan requires:

1. installers and **manual** upgrades proven on all three OSes;
2. then add `tauri-plugin-updater` with stable-channel metadata;
3. `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets;
4. a visible "Check for Updates" command whose failure leaves the app launchable.

A failed update must never strand the installed app.
