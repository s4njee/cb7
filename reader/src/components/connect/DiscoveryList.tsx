/** DISC-6 — "ON YOUR NETWORK": servers the Rust mDNS browser found on the LAN,
 *  as tappable cards above the manual address field.
 *
 *  The section is **entirely absent** until a result arrives (and always in
 *  browser dev, where discovery is a no-op): a first-run desktop user must see
 *  exactly the screen they saw before this feature existed — no empty header,
 *  no reserved space, no layout shift when nothing is ever found (QR-5). */
import { useEffect, useState } from "react";
import * as api from "../../lib/api";

interface Props {
  /** Runs the same probe → route path as the manual form (one code path). */
  onPick: (url: string) => void;
  /** A probe is in flight somewhere on the screen; don't queue a second. */
  busy: boolean;
}

export default function DiscoveryList({ onPick, busy }: Props) {
  const [servers, setServers] = useState<api.DiscoveredServer[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!api.discoverySupported) return;

    // `alive` closes the unmount race: the listener may resolve after cleanup
    // has already run, in which case we unlisten immediately rather than leak a
    // subscription that outlives the screen.
    let alive = true;
    let unlisten: (() => void) | null = null;

    setScanning(true);
    const timer = window.setTimeout(() => {
      if (alive) setScanning(false);
    }, api.DISCOVERY_WINDOW_MS);

    void (async () => {
      const off = await api.onDiscoveredServer((found) => {
        if (!alive) return;
        // The Rust side promises no duplicate `url` within a browse window;
        // de-duplicating on it here too is cheap and keeps a re-browse honest.
        setServers((prev) =>
          prev.some((s) => s.url === found.url) ? prev : [...prev, found],
        );
      });
      if (!alive) {
        off();
        return;
      }
      unlisten = off;
      await api.startDiscovery();
    })();

    return () => {
      alive = false;
      window.clearTimeout(timer);
      unlisten?.();
      void api.stopDiscovery();
    };
  }, []);

  if (!api.discoverySupported || servers.length === 0) return null;

  return (
    <section className="disc">
      <div className="disc-head">
        <div className="field-label disc-label">On your network</div>
        {scanning && (
          <div className="disc-scanning" aria-live="polite">
            <span className="disc-dot" aria-hidden="true" />
            Looking…
          </div>
        )}
      </div>

      <div className="disc-cards">
        {servers.map((s) => (
          <button
            key={s.url}
            type="button"
            className="disc-card"
            onClick={() => onPick(s.url)}
            disabled={busy}
          >
            <span className="disc-card-text">
              <span className="disc-name">{s.name}</span>
              <span className="disc-addr">{s.addr}</span>
            </span>
            {s.version && <span className="disc-ver">{s.version}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
