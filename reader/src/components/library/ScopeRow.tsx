/** Secondary browse row: chips for server Collections (from /api/libraries),
 *  Series (from /api/series, only those with more than one entry), and Tags.
 *
 *  Collections and series *switch scope*; a tag is a *filter* — it narrows
 *  whatever scope you are already in, and toggles off when tapped again. They
 *  share this row because they answer the same question ("show me a slice of
 *  the library"), and one chip UI serves both shelves: the tags come from
 *  `/api/tags` on a server and from the on-device catalog otherwise. Only the
 *  device shelf can count a tag's books — the server endpoint returns names
 *  alone — so counts appear where they are actually known.
 */
import type { LibraryInfo, SeriesInfo } from "../../lib/api";
import type { Scope, TagChip } from "./libraryData";

export default function ScopeRow({
  libraries,
  series,
  tags,
  activeTag,
  onPick,
  onPickTag,
}: {
  libraries: LibraryInfo[];
  series: SeriesInfo[];
  tags: TagChip[];
  activeTag: string | null;
  onPick: (scope: Scope) => void;
  onPickTag: (tag: string | null) => void;
}) {
  // Series of one are just a single title — nothing to browse into.
  const interestingSeries = series.filter((s) => s.count > 1);
  if (libraries.length === 0 && interestingSeries.length === 0 && tags.length === 0) return null;

  return (
    <div className="scope-row">
      {libraries.length > 0 && (
        <div className="scope-group">
          <span className="scope-eyebrow">Collections</span>
          <div className="scope-chips">
            {libraries.map((l) => (
              <button
                key={`col-${l.id}`}
                className="scope-chip"
                onClick={() => onPick({ type: "collection", id: l.id, name: l.name })}
              >
                <span className="scope-chip-name">{l.name}</span>
                <span className="scope-chip-count">{l.comicCount}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div className="scope-group">
          <span className="scope-eyebrow">Tags</span>
          <div className="scope-chips">
            {tags.map((tag) => {
              const active = tag.name === activeTag;
              return (
                <button
                  key={`tag-${tag.name}`}
                  className={`scope-chip${active ? " active" : ""}`}
                  aria-pressed={active}
                  // Tapping the active tag clears it: the chip you used to get
                  // here is the obvious thing to press to get back.
                  onClick={() => onPickTag(active ? null : tag.name)}
                >
                  <span className="scope-chip-name">{tag.name}</span>
                  {tag.count != null && <span className="scope-chip-count">{tag.count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {interestingSeries.length > 0 && (
        <div className="scope-group">
          <span className="scope-eyebrow">Series</span>
          <div className="scope-chips">
            {interestingSeries.map((s) => (
              <button
                key={`ser-${s.name}`}
                className="scope-chip"
                onClick={() => onPick({ type: "series", name: s.name })}
              >
                <span className="scope-chip-name">{s.name}</span>
                <span className="scope-chip-count">{s.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
