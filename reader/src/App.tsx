/** Root view state machine (connect → library → reader), accent application,
 *  and the global brightness overlay. */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "./lib/api";
import { isTauri } from "./lib/transport";
import { usePrefs } from "./store/prefs";
import { useSession } from "./store/session";
import Connect from "./components/Connect";
import Library from "./components/Library";
import Reader from "./components/Reader";
import StatsSheet from "./components/flows/StatsSheet";
import DownloadsSheet from "./components/flows/DownloadsSheet";
import TransferBanner from "./components/flows/TransferBanner";
import "./styles/flows.css";

export default function App() {
  const qc = useQueryClient();
  const accent = usePrefs((s) => s.accent);
  const brightness = usePrefs((s) => s.brightness);
  const {
    screen,
    openRecord,
    enterLibrary,
    enterAsUser,
    enterAsGuest,
    setGuestAccess,
    openBook,
    showToast,
  } = useSession();
  const toast = useSession((s) => s.toast);
  const dismissToast = useSession((s) => s.dismissToast);
  const sheet = useSession((s) => s.sheet);

  // Auto-clear a toast after a few seconds; a fresh toast restarts the timer.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, 3600);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);

  // Accent only — app chrome is fixed Hearth Noir; reading theme is page-local.
  useEffect(() => {
    document.documentElement.setAttribute("data-accent", accent);
  }, [accent]);

  // Boot straight into the library, then reattach any server in the background.
  //
  // This is the local-first inversion: the shelf is on this device, so nothing
  // about showing it should wait on — or be blocked by — a network round trip.
  // A missing, unreachable or signed-out server is not an error here; it just
  // means the server tab isn't available yet, and the connect screen is one tap
  // away in the library menu.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    enterLibrary();

    const route = (session: api.SessionPayload, serverUrl: string) => {
      setGuestAccess(!!session.guestAccess);
      const guestChosen = useSession.getState().guestChosen;
      if (session.authenticated && session.user) {
        enterAsUser(session.user, serverUrl);
      } else if (guestChosen && session.guestAccess) {
        enterAsGuest(serverUrl);
      }
      // Otherwise: a known server we aren't signed into. The library shows the
      // local shelf and offers "Sign in" — no wall.
    };

    async function boot() {
      try {
        const cfg = await api.getConfig();
        let serverUrl = cfg.server_url;

        // Browser dev: no persisted server — probe the proxied same origin.
        if (!isTauri && serverUrl == null) {
          const session = await api.setServer("");
          serverUrl = (await api.getConfig()).server_url ?? "";
          route(session, serverUrl);
          return;
        }
        if (serverUrl == null) return; // local-only until they connect

        route(await api.getSession(), serverUrl);
      } catch {
        /* server down or signed out — the local shelf is unaffected */
      }
    }

    void boot();
  }, [enterAsGuest, enterAsUser, enterLibrary, setGuestAccess]);

  // Open In / share sheet / Files "Open with CB8": copy into the owned library
  // and open the first book. Cold-start paths may already be in Rust state
  // before the webview loads; live opens arrive as `shelf://opened-files`.
  const importingOpen = useRef(false);
  const seenOpenPaths = useRef(new Set<string>());
  useEffect(() => {
    if (!isTauri) return;

    const importPaths = async (paths: string[]) => {
      // Deduplicate cold-start take vs live emit for the same Opened event.
      const fresh = paths.filter((p) => !seenOpenPaths.current.has(p));
      for (const p of fresh) seenOpenPaths.current.add(p);
      if (!fresh.length || importingOpen.current) return;
      importingOpen.current = true;
      try {
        const added = await api.localImport(fresh);
        // Clear any store copy of this open so a remount cannot re-import.
        await api.takeOpenedPaths().catch(() => []);
        await qc.invalidateQueries({ queryKey: ["local"] });
        if (!added.length) {
          showToast("That file isn’t a supported book format.");
          return;
        }
        showToast(
          added.length === 1
            ? `Added “${added[0].title}”.`
            : `Added ${added.length} books.`,
        );
        // Open-with should land in the book, not just the shelf.
        openBook(api.toRecord(added[0]));
      } catch {
        showToast("Couldn't add that file.");
      } finally {
        importingOpen.current = false;
      }
    };

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const pending = await api.takeOpenedPaths();
        if (!cancelled && pending.length) await importPaths(pending);
        unlisten = await api.onOpenedFiles((paths) => {
          void importPaths(paths);
        });
      } catch {
        /* open-in is best-effort */
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [qc, openBook, showToast]);

  const dim = (1 - brightness) * 0.6;

  return (
    <div className="app-root">
      {screen === "boot" && <div className="reader-message">Loading…</div>}
      {screen === "connect" && <Connect />}
      {screen === "library" && <Library />}
      {screen === "reader" &&
        (openRecord ? <Reader record={openRecord} /> : <Library />)}

      {sheet === "stats" && <StatsSheet />}
      {sheet === "downloads" && <DownloadsSheet />}

      <TransferBanner />

      <div className="dim-overlay" style={{ opacity: dim }} />

      {toast && (
        <div className="toast" role="status" onClick={dismissToast}>
          {toast}
        </div>
      )}
    </div>
  );
}
