/** Table of contents + bookmarks + highlights drawer. Comics have no chapters
 *  and no highlights, so they show only the Bookmarks list (no segmented
 *  switch, default tab). */
import { useState } from "react";
import { CloseIcon, RibbonIcon } from "./icons";
import { swatchById } from "../lib/highlights";
import type { BookmarkItem, ChapterItem, HighlightItem } from "./readerTypes";

export type TocTab = "contents" | "bookmarks" | "highlights";

/** Which annotation is being edited right now, and its current note text. */
type EditingNote =
  | { kind: "bookmark"; item: BookmarkItem }
  | { kind: "highlight"; item: HighlightItem };

/** Inline textarea editor for a bookmark/highlight note. Saving an empty note
 *  clears it (the stores normalize blank → null). */
function NoteInlineEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const save = () => onSave(value);
  return (
    <div className="note-editor">
      <textarea
        className="note-editor-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Write a note…"
        rows={3}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
        }}
      />
      <div className="note-editor-actions">
        {initial ? (
          <button className="note-remove" onClick={() => onSave("")}>
            Remove note
          </button>
        ) : (
          <span />
        )}
        <span className="note-editor-spacer" />
        <button className="note-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="note-save" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

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
  onEditBookmarkNote,
  onEditHighlightNote,
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
  onEditBookmarkNote: (item: BookmarkItem, note: string) => void;
  onEditHighlightNote: (item: HighlightItem, note: string) => void;
  onClose: () => void;
}) {
  // Highlights ride along with chapters: both only exist for an EPUB, and a
  // comic must not land on a tab it can never fill.
  const active: TocTab = hasContents ? tab : "bookmarks";
  const [editingNote, setEditingNote] = useState<EditingNote | null>(null);

  return (
    <>
      <div className="drawer-head">
        <div className="drawer-title">Table of contents</div>
        <button className="close-btn" onClick={onClose} aria-label="Close">
          <CloseIcon size={17} />
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
            bookmarks.map((bm) =>
              editingNote?.kind === "bookmark" && editingNote.item.key === bm.key ? (
                <NoteInlineEditor
                  key={bm.key}
                  initial={bm.note ?? ""}
                  onCancel={() => setEditingNote(null)}
                  onSave={(note) => {
                    onEditBookmarkNote(bm, note);
                    setEditingNote(null);
                  }}
                />
              ) : (
                // Not a <button>: the row carries its own note control, and
                // nesting buttons is invalid and breaks the tap target.
                <div
                  key={bm.key}
                  className="bm-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onGoBookmark(bm)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onGoBookmark(bm);
                  }}
                >
                  <RibbonIcon size={14} fill="var(--accent)" />
                  <span className="bm-texts">
                    <span className="bm-title">{bm.title}</span>
                    <span className="bm-sub">{bm.label}</span>
                    {bm.note && <span className="bm-note">{bm.note}</span>}
                  </span>
                  <button
                    className="bm-edit"
                    aria-label="Edit note"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingNote({ kind: "bookmark", item: bm });
                    }}
                  >
                    ✎
                  </button>
                </div>
              ),
            )
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
            highlights.map((hl) =>
              editingNote?.kind === "highlight" && editingNote.item.key === hl.key ? (
                <NoteInlineEditor
                  key={hl.key}
                  initial={hl.note ?? ""}
                  onCancel={() => setEditingNote(null)}
                  onSave={(note) => {
                    onEditHighlightNote(hl, note);
                    setEditingNote(null);
                  }}
                />
              ) : (
                // Not a <button>: the row carries its own Remove + note
                // controls, and nesting buttons is invalid.
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
                  <span className="hl-texts">
                    <span className="hl-text">{hl.text}</span>
                    {hl.note && <span className="hl-note">{hl.note}</span>}
                  </span>
                  <button
                    className="hl-edit"
                    aria-label="Edit note"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingNote({ kind: "highlight", item: hl });
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="hl-row-x"
                    aria-label="Remove highlight"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveHighlight(hl.key);
                    }}
                  >
                    <CloseIcon size={15} />
                  </button>
                </div>
              ),
            )
          )}
        </div>
      )}
    </>
  );
}
