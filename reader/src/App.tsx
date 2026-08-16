/** Root view state machine (connect → library → reader), accent application,
 *  and the global brightness overlay. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "./lib/api";
import { importReportMessage } from "./lib/format";
import { isDesktop, isTauri } from "./lib/transport";
import * as platform from "./lib/platform";
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
    closeReader,
    showToast,
    bumpImport,
    requestReaderSettings,
    requestReaderSearch,
    requestLibrarySearch,
    importProgress,
    setImportProgress,
  } = useSession();
  const toast = useSession((s) => s.toast);
  const dismissToast = useSession((s) => s.dismissToast);
  const sheet = useSession((s) => s.sheet);
  const [dropActive, setDropActive] = useState(false);

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

  // Desktop chrome follows the screen: menu items enable/disable (Back to
  // Library and Reader Settings only while reading) and the native title reads
  // "CB8" in the library, "Book title — CB8" while reading.
  useEffect(() => {
    if (!isDesktop()) return;
    const reading = screen === "reader" && !!openRecord;
    api.setMenuEnabled("back-library", reading);
    api.setMenuEnabled("reader-settings", reading);
    const title = reading && openRecord ? `${openRecord.title} — CB8` : "CB8";
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setTitle(title);
      } catch {
        /* browser dev or no title support — ignore */
      }
    })();
  }, [screen, openRecord]);

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
      // The media protocol base (and isDesktop) come from Rust and are read
      // synchronously when cover URLs are built — so resolve them before the
      // library can render any cover. The boot screen covers this short wait.
      await platform.initPlatform().catch(() => {
        /* fallback base is the macOS default; still enter the library */
      });
      enterLibrary();

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

  // Open In / share sheet / Files "Open with CB8", native menu commands, and
  // drag/drop all land in `importPaths`: copy into the owned library, then
  // either open the book or leave it on the shelf. The Rust pipeline
  // (`opens.rs`) is idempotent per OS event, so cold-start take vs live emit
  // can't double-import; `seenOpenPaths` is a second, harmless net.
  const importingOpen = useRef(false);
  const seenOpenPaths = useRef(new Set<string>());

  const finishImport = useCallback(
    async (report: api.ImportReport, opts: { open: boolean }) => {
      await qc.invalidateQueries({ queryKey: ["local"] });
      const { added } = report;
      if (!added.length) {
        showToast(importReportMessage(report));
        return;
      }
      bumpImport();
      showToast(
        added.length === 1 ? `Added “${added[0].title}”.` : `Added ${added.length} books.`,
      );
      // Open-with should land in the book — but never yank an active reading
      // session out from under the reader: importing while reading leaves the
      // book on the shelf (toast above) and preserves unflushed progress.
      if (opts.open && useSession.getState().screen !== "reader") {
        openBook(api.toRecord(added[0]));
      }
    },
    [qc, showToast, bumpImport, openBook],
  );

  const importPaths = useCallback(
    async (paths: string[], opts: { open: boolean }) => {
      const fresh = paths.filter((p) => !seenOpenPaths.current.has(p));
      for (const p of fresh) seenOpenPaths.current.add(p);
      if (!fresh.length || importingOpen.current) return;
      importingOpen.current = true;
      try {
        const report = await api.localImport(fresh);
        // Clear any store copy of this open so a remount cannot re-import.
        await api.takeOpenedPaths().catch(() => []);
        await finishImport(report, opts);
      } catch {
        showToast("Couldn't add that file.");
      } finally {
        importingOpen.current = false;
        setImportProgress(null);
      }
    },
    [finishImport, showToast, setImportProgress],
  );

  // A dropped path may be a single book *or* a folder. Folders go through the
  // scan → confirm → recursive-import flow (preview, progress, cancel);
  // individual files use the plain import pipeline.
  const importDropped = useCallback(
    async (paths: string[]) => {
      if (importingOpen.current) return;
      const dirs: string[] = [];
      const files: string[] = [];
      await Promise.all(
        paths.map(async (p) => {
          const isDir = await api.pathIsDirectory(p);
          (isDir ? dirs : files).push(p);
        }),
      );
      try {
        if (files.length) await importPaths(files, { open: false });
        for (const dir of dirs) {
          const report = await api.importFolderAtPath(dir);
          if (report.added.length || report.skipped.length || report.failed.length) {
            await finishImport(report, { open: false });
          }
        }
      } finally {
        setImportProgress(null);
      }
    },
    [importPaths, finishImport, setImportProgress],
  );

  // Native menu "Add Books…" routes through the same picker as the shelf.
  const addBooksViaPicker = useCallback(async () => {
    if (importingOpen.current) return;
    importingOpen.current = true;
    try {
      const report = await api.pickAndImportBooks();
      if (report.added.length || report.skipped.length || report.failed.length) {
        await finishImport(report, { open: false });
      }
    } catch {
      showToast("Couldn't add those files.");
    } finally {
      importingOpen.current = false;
    }
  }, [finishImport, showToast]);

  useEffect(() => {
    if (!isTauri) return;

    let unlistenOpened: (() => void) | undefined;
    let unlistenMenu: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const pending = await api.takeOpenedPaths();
        if (!cancelled && pending.length) await importPaths(pending, { open: true });
        unlistenOpened = await api.onOpenedFiles((paths) => {
          void importPaths(paths, { open: true });
        });
      } catch {
        /* open-in is best-effort */
      }
      try {
        // Native menu commands — routed here, never handled in Rust:
        //  - add-books: same picker flow as the shelf button;
        //  - back-library: leave the reader without discarding progress;
        //  - reader-settings: ask the open Reader to show its settings drawer;
        //  - toggle-fullscreen: mirror the window's fullscreen state.
        unlistenMenu = await api.onMenuCommand((command) => {
          switch (command) {
            case "add-books":
              void addBooksViaPicker();
              break;
            case "back-library":
              closeReader();
              break;
            case "reader-settings":
              requestReaderSettings();
              break;
            case "library-search":
              // Cmd/Ctrl+F: in-book search while reading, library search otherwise.
              if (screen === "reader" && openRecord) requestReaderSearch();
              else requestLibrarySearch();
              break;
            case "toggle-fullscreen":
              void api.toggleFullscreen();
              break;
            case "open-logs":
              void api.openLogs();
              break;
          }
        });
      } catch {
        /* menu command is best-effort */
      }
      try {
        // Drag a book (or several) onto the window: import all, don't force-open.
        // Mobile webviews never fire OS file drag events, so this is desktop in
        // practice; the helper gates on Tauri, and `isDesktop()` is not reliable
        // here (platform info may still be resolving during boot).
        unlistenDrop = await api.onFileDrop(setDropActive, (paths) => {
          void importDropped(paths);
        });
      } catch {
        /* drag/drop is best-effort */
      }
      try {
        // Live progress of batch/folder imports → the overlay + cancel button.
        unlistenProgress = await api.onLocalImportProgress((p) => {
          setImportProgress(p);
        });
      } catch {
        /* progress is best-effort */
      }
    })();

    return () => {
      cancelled = true;
      unlistenOpened?.();
      unlistenMenu?.();
      unlistenDrop?.();
      unlistenProgress?.();
    };
  }, [importPaths]);

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

      {/* OS file drag-over: a clear drop target over the whole window. */}
      {dropActive && isDesktop() && (
        <div className="drop-target" aria-hidden="true">
          <div className="drop-target-inner">
            <div className="drop-target-title">Add books</div>
            <div className="drop-target-sub">Drop EPUB, PDF, or CBZ files</div>
          </div>
        </div>
      )}

      <div className="dim-overlay" style={{ opacity: dim }} />

      {/* Live batch/folder import progress with a cancel button. */}
      {importProgress && (
        <div className="import-progress" role="status">
          <div className="import-progress-label">
            Importing {importProgress.done + 1} of {importProgress.total}
          </div>
          <div className="import-progress-track">
            <div
              className="import-progress-fill"
              style={{ width: `${(importProgress.done / Math.max(1, importProgress.total)) * 100}%` }}
            />
          </div>
          <button
            className="btn-ghost"
            onClick={() => {
              void api.localCancelImport();
              setImportProgress(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {toast && (
        <div className="toast" role="status" onClick={dismissToast}>
          {toast}
        </div>
      )}
    </div>
  );
}
