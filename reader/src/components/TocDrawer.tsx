/** Table of contents + bookmarks + highlights drawer. Comics have no chapters
 *  and no highlights, so they show only the Bookmarks list (no segmented
 *  switch, default tab). */
import { RibbonIcon } from "./icons";
import { swatchById } from "../lib/highlights";
import type { BookmarkItem, ChapterItem, HighlightItem } from "./readerTypes";

export type TocTab = "contents" | "bookmarks" | "highlights";

export default function TocDrawer({
  bookTitle,
  hasContents,
  chapters,
  bookmarks,
  highlights,
  tab,
  onTabChange,
  onGoChapter,
  onGoBookmark,
  onGoHighlight,
  onRemoveHighlight,
  onClose,
}: {
  bookTitle: string;
  hasContents: boolean;
  chapters: ChapterItem[];
  bookmarks: BookmarkItem[];
  highlights: HighlightItem[];
  tab: TocTab;
  onTabChange: (tab: TocTab) => void;
  onGoChapter: (target: string | number) => void;
  onGoBookmark: (item: BookmarkItem) => void;
  onGoHighlight: (item: HighlightItem) => void;
  onRemoveHighlight: (key: string) => void;
  onClose: () => void;
}) {
  // Highlights ride along with chapters: both only exist for an EPUB, and a
  // comic must not land on a tab it can never fill.
  const active: TocTab = hasContents ? tab : "bookmarks";

  return (
    <>
      <div className="drawer-head">
        <div className="drawer-title">Table of contents</div>
        <button className="close-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {hasContents && (
        <div className="segmented-wrap">
          <div className="segmented">
            <button
              className={`seg-btn small${active === "contents" ? " active" : ""}`}
              onClick={() => onTabChange("contents")}
            >
              Contents
            </button>
            <button
              className={`seg-btn small${active === "bookmarks" ? " active" : ""}`}
              onClick={() => onTabChange("bookmarks")}
            >
              Bookmarks
            </button>
            <button
              className={`seg-btn small${active === "highlights" ? " active" : ""}`}
              onClick={() => onTabChange("highlights")}
            >
              Highlights
            </button>
          </div>
        </div>
      )}

      {active === "contents" && (
        <>
          <div className="toc-sub">{bookTitle}</div>
          <div className="toc-list">
            {chapters.map((ch) => (
              <button
                key={ch.key}
                className={`toc-row${ch.active ? " active" : ""}`}
                onClick={() => onGoChapter(ch.target)}
              >
                <span className="toc-num">{ch.num}</span>
                <span className="toc-title">{ch.title}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {active === "bookmarks" && (
        <div className="bm-list">
          {bookmarks.length === 0 ? (
            <div className="bm-empty">
              No bookmarks yet.
              <br />
              Tap the ribbon while reading to save your place.
            </div>
          ) : (
            bookmarks.map((bm) => (
              <button key={bm.key} className="bm-row" onClick={() => onGoBookmark(bm)}>
                <RibbonIcon size={14} fill="var(--accent)" />
                <span className="bm-texts">
                  <span className="bm-title">{bm.title}</span>
                  <span className="bm-sub">{bm.label}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {active === "highlights" && (
        <div className="bm-list">
          {highlights.length === 0 ? (
            <div className="bm-empty">
              No highlights yet.
              <br />
              Select a passage while reading to mark it.
            </div>
          ) : (
            highlights.map((hl) => (
              // Not a <button>: the row carries its own Remove control, and
              // nesting buttons is invalid and breaks the tap target.
              <div
                key={hl.key}
                className="hl-row"
                role="button"
                tabIndex={0}
                onClick={() => onGoHighlight(hl)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onGoHighlight(hl);
                }}
              >
                <span className="hl-chip" style={{ background: swatchById(hl.color).chip }} />
                <span className="hl-text">{hl.text}</span>
                <button
                  className="hl-row-x"
                  aria-label="Remove highlight"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveHighlight(hl.key);
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
