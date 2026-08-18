/** The "what am I actually looking at" bar.
 *
 *  Only shows the narrowings that aren't already obvious from a control still
 *  on screen: the search term (the box is small and easy to forget), the scope
 *  you browsed into, and the local tag / collection filters. Media type and
 *  read status stay out of here — their own pills are right above and already
 *  read as active.
 *
 *  Every chip removes exactly one thing, which is what lets a search term
 *  survive a scope change honestly: it stays visible, and undoing it is one tap
 *  rather than a hunt back to the search box. */
export interface FilterChip {
  key: string;
  /** What kind of narrowing this is: "Search", "Series", "Tag"… */
  kind: string;
  value: string;
  onRemove: () => void;
}
import { CloseIcon } from "../icons";

export default function ActiveFilters({
  chips,
  count,
  onClearAll,
}: {
  chips: FilterChip[];
  /** Result count under the current filters, so the bar says what it cost. */
  count: string;
  onClearAll: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="active-filters" role="group" aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="active-chip"
          onClick={chip.onRemove}
          aria-label={`Remove ${chip.kind} filter ${chip.value}`}
          title={`Remove ${chip.kind}: ${chip.value}`}
        >
          <span className="active-chip-kind">{chip.kind}</span>
          <span className="active-chip-value">{chip.value}</span>
          <span className="active-chip-x" aria-hidden="true">
            <CloseIcon size={13} />
          </span>
        </button>
      ))}
      <span className="active-filters-count">{count}</span>
      {chips.length > 1 && (
        <button type="button" className="active-clear" onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
