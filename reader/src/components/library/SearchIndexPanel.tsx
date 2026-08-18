/** Search index storage — what "search inside your books" costs on this
 *  device, how full it is, and the three controls that matter: turn it off
 *  (which frees the space), rebuild it, and watch a rebuild run. */
import { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import { CloseIcon } from "../icons";

function mb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SearchIndexPanel({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<api.LocalSearchSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"disable" | "rebuild" | null>(null);

  const reload = useCallback(() => {
    void api
      .localSearchSettings()
      .then(setSettings)
      .catch(() => setError("Couldn't read the search index."));
  }, []);

  useEffect(() => {
    reload();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    let off = () => {};
    let live = true;
    void api
      .onSearchIndexProgress((p) => {
        setSettings((prev) => (prev ? { ...prev, ...p } : prev));
        // A finished pass changed the counts, not just the progress.
        if (!p.indexing) reload();
      })
      .then((f) => {
        if (live) off = f;
        else f();
      });
    return () => {
      live = false;
      off();
      document.removeEventListener("keydown", onKey);
    };
  }, [reload, onClose]);

  const run = async (action: () => Promise<api.LocalSearchSettings>) => {
    setBusy(true);
    setError(null);
    try {
      setSettings(await action());
    } catch {
      setError("That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const enabled = settings?.enabled ?? false;
  const used = settings?.indexedBytes ?? 0;
  const cap = settings?.maxBytes ?? 0;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">Search index</div>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={17} />
        </button>
      </div>
      <p className="panel-sub">
        Searching inside your books keeps their text in an index on this device. It is built in
        the background, capped, and rebuilt from your files — deleting it never costs you a book.
      </p>
      {error && <div className="error-text">{error}</div>}

      <label className="search-index-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || !settings}
          onChange={(e) => { if (e.target.checked) void run(() => api.setLocalSearchEnabled(true)); else setConfirm("disable"); }}
        />
        <span>Search inside books</span>
      </label>

      {enabled && settings && (
        <>
          <div className="search-index-usage">
            <div className="search-index-bar">
              <span className="search-index-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="search-index-figures">
              <span>
                {mb(used)} of {mb(cap)}
              </span>
              <span>
                {settings.indexedBooks} {settings.indexedBooks === 1 ? "book" : "books"} indexed
              </span>
            </div>
          </div>
          {settings.cappedBooks > 0 && (
            <div className="panel-empty">
              {settings.cappedBooks} {settings.cappedBooks === 1 ? "book is" : "books are"} not
              indexed — the index is full. Their text still searches inside the book itself.
            </div>
          )}
          <div className="search-index-status">
            {settings.indexing
              ? settings.total > 0
                ? `Indexing — ${settings.done} of ${settings.total}…`
                : "Indexing…"
              : "Up to date."}
          </div>
        </>
      )}

      <div className="linked-folder-actions">
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || !enabled}
          onClick={() => setConfirm("rebuild")}
        >
          Rebuild index
        </button>
      </div>
      {confirm === "disable" && <div className="settings-confirm"><p className="settings-confirm-text">Disable search and delete the {mb(used)} full-text index? Your books are not affected; the index can be rebuilt later.</p><div className="settings-confirm-row"><button type="button" className="settings-confirm-btn" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="settings-confirm-btn danger" onClick={() => { setConfirm(null); void run(() => api.setLocalSearchEnabled(false)); }}>Disable and free {mb(used)}</button></div></div>}
      {confirm === "rebuild" && <div className="settings-confirm"><p className="settings-confirm-text">Replace the current {mb(used)} search index by rebuilding it from your books? This frees the current index before rebuilding and may take time in the background.</p><div className="settings-confirm-row"><button type="button" className="settings-confirm-btn" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="settings-confirm-btn danger" onClick={() => { setConfirm(null); void run(api.reindexLocalSearch); }}>Rebuild index</button></div></div>}
    </div>
  );
}
