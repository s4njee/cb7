/** Server connect + sign-in. Not part of the design spec — styled with the same
 *  tokens (eyebrow + Newsreader heading + pill inputs + accent button).
 *
 *  Three ways onto a library, one destination (QR-5): a discovered LAN card, a
 *  scanned QR code, or a typed address. They all funnel through `connectTo()` —
 *  the single probe → route path — so routing, guest handling and error copy
 *  can never fork between them. */
import { useState } from "react";
import * as api from "../lib/api";
import { toApiError } from "../lib/transport";
import { allGuestProgress } from "../lib/guestProgress";
import { useSession } from "../store/session";
import GuestSyncPrompt from "./flows/GuestSyncPrompt";
import DiscoveryList from "./connect/DiscoveryList";
import ScanButton from "./connect/ScanButton";
import OpdsPanel from "./opds/OpdsPanel";
import "../styles/connect.css";
import "../styles/opds.css";

/** One friendly, non-technical line per rejection reason (QR-3). The user is
 *  holding a phone at a screen; "bad-url" is not a sentence. */
const PAIR_ERROR: Record<api.PairReason, string> = {
  "not-shelf": "This code isn't a CB8 pairing code.",
  "bad-version": "This code is from a newer version of CB8.",
  "bad-url": "That code's address looks wrong.",
};

const CAMERA_ERROR = "Camera unavailable — type the address instead.";
const TOKEN_ERROR = "Code expired — scan a fresh one.";

/** What a successful probe settled on. */
interface Connected {
  resolved: string;
  session: api.SessionPayload;
}

export default function Connect() {
  const {
    connectStep,
    connectError,
    guestAccess,
    serverUrl,
    lastUsername,
    setConnectStep,
    setConnectError,
    setGuestAccess,
    goConnect,
    enterAsUser,
    enterAsGuest,
    cancelConnect,
    bumpImport,
  } = useSession();

  const [server, setServer] = useState(serverUrl || "");
  const [username, setUsername] = useState(lastUsername || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Set once a sign-in succeeds while guest progress is waiting to be uploaded.
  // We hold on the connect screen (session already authenticated) to run the
  // sync, then enter the library — see GuestSyncPrompt.
  const [pendingSync, setPendingSync] = useState<{ user: api.User; serverUrl: string } | null>(null);
  const [opdsOpen, setOpdsOpen] = useState(false);

  async function resolveServerUrl(): Promise<string> {
    const cfg = await api.getConfig();
    return cfg.server_url ?? "";
  }

  /** The one probe → route path: manual entry, a discovered card and a scanned
   *  code all land here. Returns null when the probe failed, having set the
   *  standard inline error (the caller's own surface — a discovery card, say —
   *  stays exactly as it was; the server may just be mid-restart).
   *  Busy state is the caller's, so a multi-step flow (scan → pair) can hold it
   *  across the whole sequence instead of flickering between steps. */
  async function connectTo(url: string): Promise<Connected | null> {
    setConnectError(null);
    try {
      const session = await api.setServer(url);
      const resolved = await resolveServerUrl();
      setGuestAccess(!!session.guestAccess);
      if (session.authenticated && session.user) {
        enterAsUser(session.user, resolved);
      } else {
        goConnect("signin", { serverUrl: resolved, guestAccess: !!session.guestAccess });
      }
      return { resolved, session };
    } catch (err) {
      setConnectError(toApiError(err).message);
      return null;
    }
  }

  /** Shared tail of every real sign-in (credentials or pairing token): offer to
   *  upload anything captured while browsing as a guest, then enter. */
  function finishSignIn(user: api.User, resolved: string) {
    void api.syncBookmarksOutbox();
    const hasGuestProgress = Object.keys(allGuestProgress(resolved)).length > 0;
    if (hasGuestProgress) {
      setPendingSync({ user, serverUrl: resolved });
    } else {
      enterAsUser(user, resolved);
    }
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  function submitServer(e: React.FormEvent) {
    e.preventDefault();
    void withBusy(async () => {
      await connectTo(server);
    });
  }

  /** A tapped discovery card — identical path to the form, no fork. */
  function pickDiscovered(url: string) {
    setServer(url);
    void withBusy(async () => {
      await connectTo(url);
    });
  }

  /** QR-3: scan → parse → the same probe → optional token sign-in. Every branch
   *  ends somewhere the user can act: never a crash, never a dead end. */
  function startScan() {
    void withBusy(async () => {
      setConnectError(null);

      let text: string | null;
      try {
        text = await api.scanQr();
      } catch {
        // Permission refused, no camera, plugin unhappy — all the same to the
        // user, who just needs to be told the other door is open.
        setConnectError(CAMERA_ERROR);
        return;
      }
      // Cancelled: back to the connect screen with state intact.
      if (text === null) return;

      const parsed = api.parsePairPayload(text);
      if (!parsed.ok) {
        setConnectError(PAIR_ERROR[parsed.reason]);
        return;
      }

      const connected = await connectTo(parsed.url);
      if (!connected) return; // unreachable server — inline error already set

      // No token (QR v1), or the probe found a live session already: connectTo
      // has done the routing.
      if (!parsed.token || connected.session.authenticated) return;

      try {
        const paired = await api.pairWithToken(parsed.token);
        // The pair response carries the user; re-reading the session confirms
        // the cookie actually stuck before we commit to the library.
        const session = await api.getSession();
        const user = session.user ?? paired.user;
        if (user) {
          finishSignIn(user, connected.resolved);
        } else {
          setConnectError(TOKEN_ERROR);
        }
      } catch {
        // Wrong, expired or already used — indistinguishable by contract. We're
        // already on the sign-in form (connectTo routed there): explain and let
        // them type instead.
        setConnectError(TOKEN_ERROR);
      }
    });
  }

  function submitSignin(e: React.FormEvent) {
    e.preventDefault();
    void withBusy(async () => {
      setConnectError(null);
      try {
        await api.login(username, password);
        const session = await api.getSession();
        const resolved = await resolveServerUrl();
        if (session.authenticated && session.user) {
          finishSignIn(session.user, resolved);
        } else {
          setConnectError("Signed in, but the session did not stick. Try again.");
        }
      } catch (err) {
        setConnectError(toApiError(err).message);
      }
    });
  }

  async function continueAsGuest() {
    const resolved = await resolveServerUrl();
    enterAsGuest(resolved);
  }

  return (
    <div className="connect">
      {pendingSync && (
        <GuestSyncPrompt
          serverUrl={pendingSync.serverUrl}
          onFinish={() => {
            const { user, serverUrl: url } = pendingSync;
            setPendingSync(null);
            enterAsUser(user, url);
          }}
        />
      )}
      <div className="connect-inner">
        {/* Connecting is optional (the local shelf is always there), so there is
            always a way back out of this screen — it is a detour, not a gate. */}
        <button type="button" className="connect-back" onClick={cancelConnect}>
          ‹ Your shelf
        </button>
        <div className="eyebrow">CB8</div>
        <div className="connect-title">
          {connectStep === "server" ? "Connect a library" : "Sign in"}
        </div>
        <div className="connect-sub">
          {connectStep === "server"
            ? "Optional. Point CB8 at your server to browse its library and download books onto this device."
            : "Enter your credentials, or continue as a guest to browse read-only."}
        </div>

        {connectStep === "server" ? (
          <>
            {/* Order (QR-5): discovered → scan → manual. Both of the first two
                render nothing at all when unavailable, leaving the original
                screen byte for byte. */}
            <DiscoveryList onPick={pickDiscovered} busy={busy} />
            <ScanButton onScan={startScan} busy={busy} />
            <form onSubmit={submitServer}>
              <div className="field-label">Server address</div>
              <input
                className="pill-input"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="http://192.168.1.20:8008"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                autoFocus
              />
              {connectError && <div className="error-text">{connectError}</div>}
              <button className="btn-accent" type="submit" disabled={busy}>
                {busy ? "Connecting…" : "Continue"}
              </button>
            </form>
            {api.opdsSupported && (
              <div className="opds-connect">
                <div className="field-label">Or get books from a catalog</div>
                <div className="opds-connect-sub">
                  Standard Ebooks, Project Gutenberg, Calibre-Web, or a CB8 OPDS feed.
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setOpdsOpen(true)}
                  disabled={busy}
                >
                  Add OPDS catalog
                </button>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={submitSignin}>
            <div className="field-label">Username</div>
            <input
              className="pill-input"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
            <div className="field-label">Password</div>
            <input
              className="pill-input"
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {connectError && <div className="error-text">{connectError}</div>}
            <button className="btn-accent" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {guestAccess && (
              <button
                type="button"
                className="btn-ghost"
                onClick={continueAsGuest}
                disabled={busy}
              >
                Continue as guest
              </button>
            )}
            <div className="link-row">
              <button
                type="button"
                className="link-btn"
                onClick={() => setConnectStep("server")}
              >
                Change server
              </button>
            </div>
          </form>
        )}
      </div>
      {opdsOpen && (
        <div className="sheet-backdrop" onClick={() => setOpdsOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <OpdsPanel
              onClose={() => setOpdsOpen(false)}
              onImported={() => bumpImport()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
