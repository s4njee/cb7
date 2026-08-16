# Deploying Shelf (CB8) to a physical iPad / iPhone

This is the "get the current source onto my own device" path: a signed release
build exported with the `debugging` method, installed over USB/Wi-Fi with
`devicectl`. It is **not** App Store / TestFlight distribution.

Bundle id `com.cb8.shelf`, product name `CB8`, team `CBCWMTN2X2`.

## Prerequisites

- Xcode (26.5 used here) + command line tools: `xcode-select -p` →
  `/Applications/Xcode.app/Contents/Developer`
- `pnpm`, Rust with the device target: `rustup target add aarch64-apple-ios`
- `xcodegen` (`brew install xcodegen`) — regenerates `reader.xcodeproj`
- An Apple ID added in Xcode → Settings → Accounts, with a valid
  `Apple Development` signing identity: `security find-identity -v -p codesigning`
- The device plugged in (or paired over Wi-Fi) and **unlocked**, with the Mac
  trusted on the device.

The signing team is pinned in two places and both must agree:
`src-tauri/tauri.conf.json` → `bundle.iOS.developmentTeam`, and
`src-tauri/gen/apple/project.yml` → `DEVELOPMENT_TEAM`.

## 1. Find the device

```bash
xcrun devicectl list devices
```

Two different identifiers matter, and they are easy to confuse:

- the **CoreDevice identifier** (e.g. `A977B401-4C09-5435-BE11-DCA6E9AD2A69`) —
  this is what `devicectl --device` wants;
- the **hardware UDID** (e.g. `00008112-000858E10A83A01E`) — this is what has to
  appear in the provisioning profile's `ProvisionedDevices`.

Get the hardware UDID with:

```bash
xcodebuild -showdestinations -project reader/src-tauri/gen/apple/reader.xcodeproj -scheme reader_iOS
```

A device in state `unavailable` in `devicectl list devices` is paired but not
currently reachable — plug it in or bring it onto the same network first.

## 2. Build and export the IPA

```bash
cd reader
pnpm install                      # first time / after dependency changes
pnpm tauri ios build --target aarch64
```

What this does, in order: runs `beforeBuildCommand` (`pnpm build` → `tsc` +
Vite into `reader/dist`), compiles the Rust core for `aarch64-apple-ios` into
`libapp.a` via the project's *Build Rust Code* pre-build script, builds and
signs the `reader_iOS` target in Release, then exports with
`src-tauri/gen/apple/ExportOptions.plist` (`method = debugging`).

Output:

```
reader/src-tauri/gen/apple/build/arm64/CB8.ipa
```

Also written: `build/reader_iOS.xcarchive` and `build/Payload/CB8.app` (handy
for `ios-deploy` or manual inspection).

Notes:

- Versions come from `tauri.conf.json` → `version`; the build stamps both
  `CFBundleShortVersionString` and `CFBundleVersion` into
  `gen/apple/reader_iOS/Info.plist`. Bump `tauri.conf.json` before a build you
  want to tell apart on-device.
- `gen/apple/` is checked in. If you change `project.yml`, re-run `xcodegen
  generate` inside `src-tauri/gen/apple` (or `pnpm tauri ios init`, which
  rewrites more than you probably want).
- Xcode picks the signing identity and an *iOS Team Provisioning Profile*
  automatically. Watch the `CodeSign` line in the build output to confirm which
  identity and profile were used.

## 3. Install on the device

```bash
xcrun devicectl device install app \
  --device <CoreDevice-identifier> \
  reader/src-tauri/gen/apple/build/arm64/CB8.ipa
```

Success prints `App installed:` with `bundleID: com.cb8.shelf` and the on-device
`installationURL`. Installing over an existing copy keeps the app's data
container (library, downloads, cookies); it is an upgrade, not a wipe.

Alternative, if you prefer `ios-deploy` (installs the `.app`, not the `.ipa`):

```bash
ios-deploy --id <hardware-UDID> --bundle reader/src-tauri/gen/apple/build/Payload/CB8.app
```

## 4. If the first launch is refused

A launch attempted immediately after install often fails with:

```
Unable to launch com.cb8.shelf because it has an invalid code signature,
inadequate entitlements or its profile has not been explicitly trusted by the user.
```

**Retry once — usually that's all it is.** iOS is still verifying the freshly
installed bundle for a few seconds after `devicectl` reports success, and it
reports that state with this (misleading) security error. Waiting ~10s and
launching again succeeds.

If it keeps failing, then the developer certificate genuinely isn't trusted on
the device. That cannot be done from the Mac:

> Settings → General → VPN & Device Management → Developer App →
> *Apple Development: &lt;your Apple ID&gt;* → **Trust**

This is a one-time step per device per certificate.

## 5. Launch and watch logs

```bash
xcrun devicectl device process launch --device <CoreDevice-identifier> com.cb8.shelf

# with stdout/stderr attached (RUST_LOG=info is baked into the scheme):
xcrun devicectl device process launch --console \
  --device <CoreDevice-identifier> com.cb8.shelf
```

Confirm it's actually up:

```bash
xcrun devicectl device info processes --device <CoreDevice-identifier> | grep CB8
```

Webview-side debugging: Safari → Develop → *&lt;device&gt;* → CB8 inspects the
React app (the device needs Settings → Safari → Advanced → Web Inspector on).

## 6. Point the app at a server

The app ships with no server baked in. On first run, the connect screen takes
the CB8 server's **LAN** address — `http://192.168.x.y:4218` for the Docker
compose setup in `webui/packaging/docker` — since `localhost` on the iPad is the
iPad. Prefer HTTPS for anything reachable from outside the network.

## Profile expiry

Personal-team provisioning profiles carry a 7-day TTL (`TimeToLive: 7` in the
embedded `.mobileprovision`). After that the installed app stops launching and
has to be rebuilt and reinstalled — steps 2–3. To check what the current IPA
carries:

```bash
security cms -D -i <unzipped>/Payload/CB8.app/embedded.mobileprovision | plutil -p -
```

Look at `ExpirationDate` and `ProvisionedDevices`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Unable to launch … profile has not been explicitly trusted` | Retry the launch once (post-install verification); if it persists, trust the cert on-device — step 4. |
| `The application … could not be installed` / device not provisioned | The device's hardware UDID isn't in the profile. Open `gen/apple/reader.xcodeproj` in Xcode once with the device attached and let it register the device, then rebuild. |
| `devicectl` reports the device `unavailable` | Unlock it, re-plug, or wait for Wi-Fi pairing; `xcrun devicectl list devices` should show `available (paired)`. |
| Build fails in *Build Rust Code* | Missing `aarch64-apple-ios` target, or a stale `Externals/arm64/*/libapp.a`. `rustup target add aarch64-apple-ios`; `rm -rf src-tauri/gen/apple/Externals`. |
| Frontend changes don't show up | `beforeBuildCommand` failed but the Xcode build reused `reader/dist`. Run `pnpm build` on its own and read the `tsc` errors. |
| Stale/odd behaviour after many installs | Delete the app on-device (wipes its container), then reinstall. |

## Simulator (no signing needed)

```bash
cd reader
pnpm tauri ios dev 'iPad Pro 13-inch (M5)'
```

This runs the Vite dev server and hot-reloads; it does not produce a device
build.

## Android

See the *Mobile* section of [README.md](README.md) — `pnpm tauri android build
--debug --apk --target aarch64` after setting `ANDROID_HOME`, `NDK_HOME`, and a
JDK ≤ 21 in `JAVA_HOME`.
