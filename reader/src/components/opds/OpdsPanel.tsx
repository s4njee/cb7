/** Saved OPDS catalogs + add form. Opens {@link OpdsBrowser} for a catalog. */
import { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import { toApiError } from "../../lib/transport";
import OpdsBrowser from "./OpdsBrowser";
import { CloseIcon } from "../icons";
import "../../styles/library.css";
import "../../styles/opds.css";

export default function OpdsPanel({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [catalogs, setCatalogs] = useState<api.OpdsCatalog[]>([]);
  const [browsing, setBrowsing] = useState<api.OpdsCatalog | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void api.opdsListCatalogs().then(setCatalogs).catch(() => setCatalogs([]));
  }, []);

  useEffect(() => {
    reload();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !browsing) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reload, onClose, browsing]);

  const add = async (preset?: { name: string; url: string }) => {
    const nextName = (preset?.name ?? name).trim();
    const nextUrl = (preset?.url ?? url).trim();
    if (!nextUrl) {
      setError("Enter a catalog address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const catalog = await api.opdsAddCatalog({
        name: nextName,
        url: nextUrl,
        username: username.trim() || undefined,
        password: password || undefined,
      });
      setName("");
      setUrl("");
      setUsername("");
      setPassword("");
      setAdding(false);
      reload();
      setBrowsing(catalog);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const removeCatalog = async (catalog: api.OpdsCatalog) => {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const ok = await confirm(`Remove “${catalog.name}” from this device?`, {
      title: "Remove catalog",
      kind: "warning",
    });
    if (!ok) return;
    await api.opdsRemoveCatalog(catalog.id);
    reload();
  };

  if (browsing) {
    return (
      <OpdsBrowser
        catalog={browsing}
        onClose={onClose}
        onBack={() => setBrowsing(null)}
        onImported={onImported}
      />
    );
  }

  return (
    <div className="panel opds-panel">
      <div className="panel-header">
        <div className="panel-title">OPDS catalogs</div>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={17} />
        </button>
      </div>
      <p className="panel-sub">
        Browse a public catalog or your own Calibre-Web / CB8 OPDS feed, then save a book to this
        device. Downloads become ordinary local copies — nothing stays streamed.
      </p>
      {error && <div className="error-text">{error}</div>}

      <div className="opds-preset-row">
        {api.OPDS_PRESETS.map((preset) => (
          <button
            key={preset.url}
            type="button"
            className="btn-ghost opds-preset"
            onClick={() => void add(preset)}
            disabled={busy}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div className="opds-catalog-list">
        {catalogs.length === 0 && <div className="panel-empty">No catalogs saved yet.</div>}
        {catalogs.map((c) => (
          <div key={c.id} className="opds-catalog-row">
            <button type="button" className="opds-catalog-open" onClick={() => setBrowsing(c)}>
              <span className="opds-catalog-name">{c.name}</span>
              <span className="opds-catalog-url">{c.url}</span>
            </button>
            <button type="button" className="btn-ghost" onClick={() => void removeCatalog(c)}>
              Remove
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <form
          className="opds-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="field-label">Catalog name</div>
          <input
            className="pill-input"
            placeholder="My Calibre library"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="field-label">Catalog address</div>
          <input
            className="pill-input"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://standardebooks.org/feeds/opds"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
          <div className="field-label">Username (optional)</div>
          <input
            className="pill-input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <div className="field-label">Password</div>
          <input
            className="pill-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn-accent" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Add catalog"}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setAdding(false)} disabled={busy}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="btn-ghost" onClick={() => setAdding(true)}>
          Add OPDS catalog…
        </button>
      )}
    </div>
  );
}
