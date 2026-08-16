/** Local-book metadata editor: series/volume, free-form tags, and collections.
 *  Calls the Rust commands directly and reports completion so the parent can
 *  invalidate the shelf. Only meaningful for local records — server books keep
 *  their server-side metadata model. */
import { useState } from "react";
import * as api from "../../lib/api";
import type { WebComicRecord } from "../../lib/api";

export default function LocalMetadataEditor({
  record,
  onSaved,
  onFilterTag,
  onFilterCollection,
}: {
  record: WebComicRecord;
  onSaved?: () => void;
  onFilterTag?: (tag: string) => void;
  onFilterCollection?: (collection: string) => void;
}) {
  const [series, setSeries] = useState(record.series ?? "");
  const [volume, setVolume] = useState(record.volume ?? "");
  const [tags, setTags] = useState((record.tags ?? []).join(", "));
  const [collection, setCollection] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.localSetMetadata(
        record.id,
        series.trim() || null,
        volume.trim() || null,
        tags.split(",").map((t) => t.trim()).filter(Boolean),
      );
      onSaved?.();
    } catch {
      /* best-effort; the shelf is unaffected */
    } finally {
      setBusy(false);
    }
  };

  const toggleCollection = async (name: string) => {
    const on = !(record.collections ?? []).includes(name);
    await api.localToggleCollection(record.id, name, on);
    onSaved?.();
  };

  const addCollection = async () => {
    const name = collection.trim();
    if (!name) return;
    setCollection("");
    await api.localToggleCollection(record.id, name, true);
    onSaved?.();
  };

  const collections = record.collections ?? [];

  return (
    <div className="local-meta-editor">
      <div className="local-meta-fields">
        <label className="field-label" htmlFor="lm-series">
          Series
        </label>
        <input
          id="lm-series"
          className="pill-input"
          value={series}
          onChange={(e) => setSeries(e.target.value)}
          placeholder="Series name"
        />
        <label className="field-label" htmlFor="lm-volume">
          Volume
        </label>
        <input
          id="lm-volume"
          className="pill-input"
          value={volume}
          onChange={(e) => setVolume(e.target.value)}
          placeholder="e.g. 1"
        />
        <label className="field-label" htmlFor="lm-tags">
          Tags (comma separated)
        </label>
        <input
          id="lm-tags"
          className="pill-input"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="scifi, cyberpunk, 2020s"
        />
        <button type="button" className="btn-accent" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save metadata"}
        </button>
      </div>

      {(record.tags ?? []).length > 0 && (
        <div className="local-meta-collections">
          <div className="field-label">Tags</div>
          <div className="local-collection-list">
            {(record.tags ?? []).map((t) => (
              <button
                key={t}
                type="button"
                className="local-collection-chip filterable"
                onClick={() => onFilterTag?.(t)}
                title="Show only this tag"
              >
                {t} #{onFilterTag ? "filter" : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="local-meta-collections">
        <div className="field-label">Collections</div>
        {collections.length > 0 && (
          <div className="local-collection-list">
            {collections.map((c) => (
              <span key={c} className="local-collection-chip">
                <button
                  type="button"
                  className="local-collection-chip-name"
                  onClick={() => onFilterCollection?.(c)}
                  title={onFilterCollection ? "Show only this collection" : c}
                >
                  {c}
                </button>
                <button
                  type="button"
                  className="local-collection-chip-x"
                  onClick={() => toggleCollection(c)}
                  title="Remove from this collection"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="local-collection-add">
          <input
            className="pill-input"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            placeholder="New collection name"
            onKeyDown={(e) => {
              if (e.key === "Enter") void addCollection();
            }}
          />
          <button type="button" className="btn-ghost" onClick={addCollection}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
