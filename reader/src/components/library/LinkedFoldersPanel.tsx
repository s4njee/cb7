/** Linked library folders — folders read in place (no copy), with manual
 *  Rescan and missing-book Locate/Remove flows. Desktop-only. */
import { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import { CloseIcon } from "../icons";

export default function LinkedFoldersPanel({
  onChanged,
  onClose,
}: {
  onChanged: () => void;
  onClose: () => void;
}) {
  const [folders, setFolders] = useState<api.LinkedFolder[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void api.localLinkedFolders().then(setFolders).catch(() => setFolders([]));
  }, []);

  useEffect(() => {
    reload();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reload, onClose]);

  const pickAndAdd = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false });
    if (!picked || Array.isArray(picked)) return;
    setBusy(true);
    setError(null);
    try {
      await api.localAddLinkedFolder(String(picked));
      reload();
      onChanged();
    } catch {
      setError("Couldn't attach that folder.");
    } finally {
      setBusy(false);
    }
  };

  const rescan = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.localRescanLinkedFolders();
      reload();
      onChanged();
    } catch {
      setError("Rescan failed.");
    } finally {
      setBusy(false);
    }
  };

  const removeFolder = async (id: number) => {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const ok = await confirm(
      "Remove this folder from the library? Books on disk are untouched.",
      { title: "Remove linked folder", kind: "warning" },
    );
    if (!ok) return;
    await api.localRemoveLinkedFolder(id);
    reload();
    onChanged();
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">Linked folders</div>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={17} />
        </button>
      </div>
      <p className="panel-sub">
        Books in these folders are read in place — nothing is copied. Files added or removed on
        disk show up after a Rescan; a moved file becomes “missing” until you locate it.
      </p>
      {error && <div className="error-text">{error}</div>}
      <div className="linked-folder-list">
        {folders.length === 0 && <div className="panel-empty">No linked folders yet.</div>}
        {folders.map((f) => (
          <div key={f.id} className="linked-folder-row">
            <span className="linked-folder-path" title={f.path}>
              {f.path}
            </span>
            <button type="button" className="btn-ghost" onClick={() => removeFolder(f.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="linked-folder-actions">
        <button type="button" className="btn-accent" onClick={pickAndAdd} disabled={busy}>
          {busy ? "Working…" : "Add folder…"}
        </button>
        {folders.length > 0 && (
          <button type="button" className="btn-ghost" onClick={rescan} disabled={busy}>
            Rescan all
          </button>
        )}
      </div>
    </div>
  );
}
