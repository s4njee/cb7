/** The home rows above the grid: horizontally scrolling strips of covers, one
 *  per question the shelf can answer. Rows that would be empty never render
 *  (see `homeShelfData.ts`), so the surface stays honest about what is there.
 *
 *  Deliberately not `CoverCard`: these strips are for recognition at a glance,
 *  so they carry a cover, a title and a status line. Favoriting, selection and
 *  the detail sheet all live in the grid below, where there is room for them. */
import CoverArt from "../CoverArt";
import { statusLabel } from "../../lib/format";
import type { WebComicRecord } from "../../lib/api";
import type { HomeShelf } from "./homeShelfData";

export default function HomeShelves({
  shelves,
  onOpen,
  compact = false,
}: {
  shelves: HomeShelf[];
  onOpen: (record: WebComicRecord) => void;
  compact?: boolean;
}) {
  if (shelves.length === 0) return null;
  return (
    <div className={`home-shelves${compact ? " is-compact" : ""}`}>
      {shelves.map((shelf) => (
        <section className="home-shelf" key={shelf.key} aria-label={shelf.title}>
          <h2 className="eyebrow home-shelf-title">{shelf.title}</h2>
          <div className={`home-strip${shelf.key === "recent" ? " is-wrapped" : ""}`}>
            {shelf.records.map((record) => (
              <button
                key={record.id}
                type="button"
                className="home-card"
                onClick={() => onOpen(record)}
                title={record.title}
              >
                {/* CoverArt already pins a progress bar to the cover, so the
                    row adds the words rather than a second bar. */}
                <CoverArt record={record} className="home-card-art" variant="continue" width={240} />
                <span className="home-card-title">{record.title}</span>
                <span className="home-card-meta">{statusLabel(record)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
