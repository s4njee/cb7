/** A grid cover card. One-tap opens the book; the heart favorites; an always-
 *  visible overflow opens the book detail sheet. Long-press, right-click, and
 *  keyboard (`i` / ContextMenu) also open the detail sheet so it is not hidden
 *  behind gesture discovery alone. */
import { useRef } from "react";
import { hapticTick, type WebComicRecord } from "../../lib/api";
import { statusLabel } from "../../lib/format";
import CoverArt from "../CoverArt";

/** Just under iOS's own ~500 ms callout threshold. The system menu is disabled
 *  on this card (see `-webkit-touch-callout` in app.css), but matching the
 *  platform's timing is what makes the gesture feel native rather than slow. */
const LONG_PRESS_MS = 480;

export interface CardActionAnchor {
  x: number;
  y: number;
}

export default function CoverCard({
  record,
  onOpen,
  onToggleFavorite,
  onActions,
  selected = false,
  onToggleSelect,
}: {
  record: WebComicRecord;
  onOpen: (record: WebComicRecord) => void;
  /** Signed-in / local shelf; undefined hides the heart. */
  onToggleFavorite?: (record: WebComicRecord) => void;
  /** Opens the book detail sheet. Undefined hides overflow + press menus. */
  onActions?: (record: WebComicRecord, anchor: CardActionAnchor) => void;
  /** Selection mode: true shows the check ring. */
  selected?: boolean;
  /** Present while in selection mode; Cmd/Ctrl-click calls it. */
  onToggleSelect?: () => void;
}) {
  const timer = useRef<number | null>(null);
  const longFired = useRef(false);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const clearTimer = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const openDetail = (x: number, y: number) => {
    if (!onActions) return;
    onActions(record, { x, y });
  };

  const openDetailFromCard = () => {
    const el = cardRef.current;
    if (!el) {
      openDetail(window.innerWidth / 2, window.innerHeight / 2);
      return;
    }
    const r = el.getBoundingClientRect();
    openDetail(r.left + r.width / 2, r.top + r.height / 2);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (!onActions) return;
    longFired.current = false;
    const t = e.touches[0];
    startPt.current = { x: t.clientX, y: t.clientY };
    clearTimer();
    timer.current = window.setTimeout(() => {
      longFired.current = true;
      hapticTick("chapter");
      openDetail(t.clientX, t.clientY);
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!startPt.current) return;
    const t = e.touches[0];
    if (
      Math.abs(t.clientX - startPt.current.x) > 10 ||
      Math.abs(t.clientY - startPt.current.y) > 10
    ) {
      clearTimer();
    }
  };

  const onTouchEnd = () => clearTimer();
  const onTouchCancel = () => clearTimer();

  const onClick = (e: React.MouseEvent) => {
    if (longFired.current) {
      longFired.current = false;
      return;
    }
    // In selection mode a Cmd/Ctrl click toggles instead of opening.
    if (onToggleSelect && (e.metaKey || e.ctrlKey)) {
      e.stopPropagation();
      onToggleSelect();
      return;
    }
    onOpen(record);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (!onActions) return;
    e.preventDefault();
    openDetail(e.clientX, e.clientY);
  };

  return (
    <div
      ref={cardRef}
      className={`cover-card${selected ? " selected" : ""}${onToggleSelect ? " selectable" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${record.title}. ${statusLabel(record)}. Press Enter to open${
        onActions ? ", i for details" : ""
      }${onToggleSelect ? ", Cmd/Ctrl-click to select" : ""}`}
      aria-pressed={onToggleSelect ? selected : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(record);
          return;
        }
        if (!onActions) return;
        // `i` for info, or the dedicated context-menu key on some keyboards.
        if (e.key === "i" || e.key === "I" || e.key === "ContextMenu") {
          e.preventDefault();
          openDetailFromCard();
        }
      }}
    >
      <div className="cover-wrap">
        {onToggleSelect && (
          <span className={`select-check${selected ? " on" : ""}`} aria-hidden="true">
            {selected ? "✓" : ""}
          </span>
        )}
        {record.missing && (
          <span className="missing-badge" title="File missing on disk — open to locate">
            Missing
          </span>
        )}
        <CoverArt record={record} className="cover" variant="grid" />
        {onToggleFavorite && (
          <button
            className={`fav-heart${record.favorited ? " on" : ""}`}
            aria-label={record.favorited ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={record.favorited}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(record);
            }}
          >
            <span aria-hidden="true">{record.favorited ? "♥" : "♡"}</span>
          </button>
        )}
        {onActions && (
          <button
            type="button"
            className="cover-overflow"
            aria-label={`Details for ${record.title}`}
            title="Book details"
            onClick={(e) => {
              e.stopPropagation();
              openDetailFromCard();
            }}
          >
            <span aria-hidden="true">···</span>
          </button>
        )}
      </div>
      <div>
        <div className="cover-meta-title">{record.title}</div>
        <div className="cover-meta-status">{statusLabel(record)}</div>
      </div>
    </div>
  );
}
