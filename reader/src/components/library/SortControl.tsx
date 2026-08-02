/** Compact sort pill in the filter row. Tap opens a mini-menu (styled like the
 *  avatar menu) listing the three orderings; the arrow flips asc/desc. */
import { useEffect, useRef, useState } from "react";
import { SORT_OPTIONS, labelFor, type SortChoice } from "./librarySort";

export default function SortControl({
  sort,
  onSortBy,
  onToggleOrder,
}: {
  sort: SortChoice;
  onSortBy: (sortBy: SortChoice["sortBy"]) => void;
  onToggleOrder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const arrow = sort.sortOrder === "asc" ? "↑" : "↓";

  return (
    <div className="sort-control" ref={ref}>
      <button
        className={`sort-pill${open ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Sort"
      >
        <span className="sort-pill-label">{labelFor(sort)}</span>
        <span
          className="sort-arrow"
          role="button"
          aria-label={sort.sortOrder === "asc" ? "Ascending" : "Descending"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleOrder();
          }}
        >
          {arrow}
        </span>
      </button>

      {open && (
        <div className="sort-menu" role="menu">
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.sortBy}
              className={`sort-menu-item${sort.sortBy === o.sortBy ? " active" : ""}`}
              role="menuitemradio"
              aria-checked={sort.sortBy === o.sortBy}
              onClick={() => {
                onSortBy(o.sortBy);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {sort.sortBy === o.sortBy && <span className="sort-check">{arrow}</span>}
            </button>
          ))}
          <div className="sort-menu-sep" />
          <button className="sort-menu-item" role="menuitem" onClick={onToggleOrder}>
            <span>{sort.sortOrder === "asc" ? "Ascending" : "Descending"}</span>
            <span className="sort-check">{arrow}</span>
          </button>
        </div>
      )}
    </div>
  );
}
