/** Saved servers — the list, the switch, and the two things you can do to a
 *  profile: rename it, or forget it.
 *
 *  Forgetting is deliberately not a data wipe. Downloads, pins and on-device
 *  annotations are keyed by the server's URL, so re-adding it later finds them
 *  again; the panel says so rather than making the user guess. */
import { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";

export default function ServersPanel({
  active,
  onSwitch,
  onAdd,
  onClose,
}: {
  /** URL of the server currently in use, if any. */
  active: string | null;
  onSwitch: (url: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const [servers, setServers] = useState<api.SavedServer[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void api
      .listServers()
      .then(setServers)
      .catch(() => setError("Couldn't read your saved servers."));
  }, []);

  useEffect(() => {
    reload();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reload, onClose]);

  const commitRename = async (url: string) => {
    const name = draft.trim();
    setRenaming(null);
    if (!name) return;
    try {
      setServers(await api.renameServer(url, name));
    } catch {
      setError("That name didn't stick.");
    }
  };

  const forget = async (server: api.SavedServer) => {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const ok = await confirm(
      `Forget ${server.name}? You'll be signed out of it. Books saved to this device stay, and re-adding the server finds your downloads and notes again.`,
      { title: "Forget server", kind: "warning" },
    );
    if (!ok) return;
    try {
      setServers(await api.forgetServer(server.url));
    } catch {
      setError("Couldn't forget that server.");
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">Servers</div>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="panel-sub">
        Switch between the libraries you use. Each server keeps its own session, downloads and
        notes — and the books on this device are there whichever one you pick.
      </p>
      {error && <div className="error-text">{error}</div>}

      <div className="server-list">
        {servers.length === 0 && <div className="panel-empty">No servers saved yet.</div>}
        {servers.map((server) => {
          const isActive = server.url === active;
          return (
            <div key={server.url} className={`server-row${isActive ? " active" : ""}`}>
              {renaming === server.url ? (
                <input
                  className="search-input server-rename"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void commitRename(server.url)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(server.url);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="server-pick"
                  onClick={() => !isActive && onSwitch(server.url)}
                  aria-current={isActive}
                >
                  <span className="server-name">
                    {server.name}
                    {isActive && <span className="server-current">In use</span>}
                  </span>
                  <span className="server-url">{server.url}</span>
                  {server.lastUsername && (
                    <span className="server-url">Signed in as {server.lastUsername}</span>
                  )}
                </button>
              )}
              <div className="server-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setDraft(server.name);
                    setRenaming(server.url);
                  }}
                >
                  Rename
                </button>
                <button type="button" className="btn-ghost" onClick={() => void forget(server)}>
                  Forget
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="linked-folder-actions">
        <button type="button" className="btn-accent" onClick={onAdd}>
          Add a server…
        </button>
      </div>
    </div>
  );
}
