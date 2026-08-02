/** QR-3 — the "Scan code" affordance. Renders only where the camera scanner
 *  actually exists (mobile): the capability check runs against the plugin
 *  itself, so desktop and browser dev keep manual entry + discovery with no
 *  dead button and no reserved space (QR-5). */
import { useEffect, useState } from "react";
import * as api from "../../lib/api";

interface Props {
  onScan: () => void;
  busy: boolean;
}

export default function ScanButton({ onScan, busy }: Props) {
  // Starts false so the button can only ever appear, never flash away: on
  // desktop the check resolves false and nothing was ever rendered.
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    let alive = true;
    void api.scanSupported().then((ok) => {
      if (alive) setSupported(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!supported) return null;

  return (
    <button type="button" className="btn-ghost scan-btn" onClick={onScan} disabled={busy}>
      <QrIcon />
      Scan code
    </button>
  );
}

function QrIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h3v3h-3v-3zm5 0h3v3h-3v-3zm-5 5h3v3h-3v-3zm5 0h3v3h-3v-3z" />
    </svg>
  );
}
