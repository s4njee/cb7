/** Secondary browse row: chips for server Collections (from /api/libraries) and
 *  Series (from /api/series, only those with more than one entry). Tapping a
 *  chip switches the grid scope. The whole row hides when both lists are empty. */
import type { LibraryInfo, SeriesInfo } from "../../lib/api";
import type { Scope } from "./libraryData";

export default function ScopeRow({
  libraries,
  series,
  onPick,
}: {
  libraries: LibraryInfo[];
  series: SeriesInfo[];
  onPick: (scope: Scope) => void;
}) {
  // Series of one are just a single title — nothing to browse into.
  const interestingSeries = series.filter((s) => s.count > 1);
  if (libraries.length === 0 && interestingSeries.length === 0) return null;

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
