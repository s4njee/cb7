#!/usr/bin/env bash
# Build the latest source and deploy it to the iPad Air over devicectl.
# Usage: ./scripts/deploy-ipad.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
READER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$READER_DIR"

BUNDLE_ID="com.cb8.shelf"
IPA_PATH="src-tauri/gen/apple/build/arm64/CB8.ipa"

echo "==> Locating iPad Air"
DEVICE_LINE="$(xcrun devicectl list devices | grep "iPad Air" || true)"

if [[ -z "$DEVICE_LINE" ]]; then
  echo "error: no iPad Air found in 'xcrun devicectl list devices'." >&2
  echo "Plug it in / bring it onto Wi-Fi and make sure it's unlocked and trusted." >&2
  exit 1
fi

if [[ "$(echo "$DEVICE_LINE" | wc -l)" -gt 1 ]]; then
  echo "error: multiple iPad Air devices found; refine the match:" >&2
  echo "$DEVICE_LINE" >&2
  exit 1
fi

DEVICE_ID="$(echo "$DEVICE_LINE" | awk '{print $3}')"
DEVICE_STATE="$(echo "$DEVICE_LINE" | grep -o "available (paired)" || true)"

echo "    device: $DEVICE_LINE"

if [[ -z "$DEVICE_STATE" ]]; then
  echo "error: iPad Air is not 'available (paired)'. Unlock it, re-plug, or wait for Wi-Fi pairing." >&2
  exit 1
fi

echo "==> Installing JS dependencies (if needed)"
if [[ ! -d node_modules ]]; then
  pnpm install
fi

echo "==> Building and signing for aarch64-apple-ios"
pnpm tauri ios build --target aarch64

if [[ ! -f "$IPA_PATH" ]]; then
  echo "error: expected IPA not found at $IPA_PATH" >&2
  exit 1
fi

echo "==> Installing on device"
xcrun devicectl device install app --device "$DEVICE_ID" "$IPA_PATH"

echo "==> Launching (retrying once if the just-installed bundle isn't verified yet)"
if ! xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"; then
  echo "    first launch attempt failed, waiting 10s and retrying..."
  sleep 10
  xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"
fi

echo "==> Done. CB8 launched on the iPad Air."
