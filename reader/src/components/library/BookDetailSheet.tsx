/** Book detail sheet — cover, metadata, source, progress, tags, and
 *  contextual actions. Replaces the flat long-press action menu so destructive
 *  and explanatory choices sit next to real context, not a bare title.
 *
 *  Entry points (Library / CoverCard): long-press, right-click, overflow ···,
 *  and keyboard `i` / ContextMenu when the card is focused. Favorite stays a
 *  one-tap heart on the card; Open stays the card tap. */
import { useEffect, useId, useState } from "react";
import type { WebComicRecord } from "../../lib/api";
import {
  ACTION_LABELS,
  canRemoveLocalCopy,
  canSaveToDevice,
  sourceBadge,
  type SourceBadge,
} from "../../lib/bookContext";
import {
  formatBytes,
  hasStarted,
  isFinished,
  kindLabel,
  lastReadLabel,
  metaLine,
  percentRead,
  statusLabel,
} from "../../lib/format";
import CoverArt from "../CoverArt";
import { CloseIcon } from "../icons";
import LocalMetadataEditor from "./LocalMetadataEditor";

export interface BookDetailActions {
  onOpen: (r: WebComicRecord) => void;
  onMarkRead: (r: WebComicRecord) => void;
  onMarkUnread: (r: WebComicRecord) => void;
  onClearProgress: (r: WebComicRecord) => void;
  onToggleFavorite: (r: WebComicRecord) => void;
  onSaveToDevice?: (r: WebComicRecord) => void;
  onRemoveLocalCopy?: (r: WebComicRecord) => void;
  /** Cleanup for a leftover offline pin (legacy path). */
  onRemoveDownload?: (r: WebComicRecord) => void;
}

export default function BookDetailSheet({
  record,
  actions,
  badge,
  showSaveToDevice,
  showRemoveLocalCopy,
  showRemoveDownload,
  onMetadataSaved,
  onFilterTag,
  onFilterCollection,
  onLocate,
  onClose,
}: {
  record: WebComicRecord;
  actions: BookDetailActions;
  badge?: SourceBadge;
  showSaveToDevice?: boolean;
  showRemoveLocalCopy?: boolean;
  showRemoveDownload?: boolean;
  /** Called after local metadata edits save, so the shelf can re-read. */
  onMetadataSaved?: () => void;
  /** Filter the local shelf to one tag / collection and close the sheet. */
  onFilterTag?: (tag: string) => void;
  onFilterCollection?: (collection: string) => void;
  /** Re-point a missing linked book at its new location on disk. */
  onLocate?: (record: WebComicRecord) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setPhone(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Lock background scroll while the sheet is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const finished = isFinished(record);
  const started = hasStarted(record);
  const pct = percentRead(record);
  const ctx = badge ?? sourceBadge({ record });
  const save =
    showSaveToDevice ?? canSaveToDevice(record, undefined, null, !!actions.onSaveToDevice);
  const removeLocal =
    showRemoveLocalCopy ?? (canRemoveLocalCopy(record) && !!actions.onRemoveLocalCopy);
  const removeDl = showRemoveDownload ?? !!actions.onRemoveDownload;
  const lastRead = lastReadLabel(record.lastRead);
  const tags = (record.tags ?? []).filter(Boolean);

  const run = (fn: (r: WebComicRecord) => void) => {
    fn(record);
    onClose();
  };

  /** Save keeps the transfer banner visible; close the sheet so it isn’t buried. */
  const runSave = () => {
    actions.onSaveToDevice?.(record);
    onClose();
  };

  return (
    <div
      className={`book-detail-backdrop${phone ? " phone" : ""}`}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`book-detail-sheet${phone ? " phone" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="book-detail-grab" aria-hidden="true" />

        <div className="book-detail-top">
          <button
            type="button"
            className="book-detail-close"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={17} />
          </button>
        </div>

        <div className="book-detail-hero">
          <div className="book-detail-cover">
            <CoverArt record={record} className="book-detail-cover-art" variant="grid" width={360} />
          </div>
          <div className="book-detail-hero-text">
            <h2 id={titleId} className="book-detail-title">
              {record.title}
            </h2>
            <div className="book-detail-meta">{metaLine(record)}</div>
            <div className="book-detail-badges">
              <span className={`source-badge tone-${ctx.tone}`}>{ctx.label}</span>
              <span className="book-detail-kind">{kindLabel(record)}</span>
            </div>
            {ctx.detail && <p className="book-detail-source-detail">{ctx.detail}</p>}
          </div>
        </div>

        <dl className="book-detail-facts">
          <div className="book-detail-fact">
            <dt>Size</dt>
            <dd>{formatBytes(record.fileSize)}</dd>
          </div>
          <div className="book-detail-fact">
            <dt>Progress</dt>
            <dd>{statusLabel(record)}</dd>
          </div>
          {lastRead && (
            <div className="book-detail-fact">
              <dt>Last read</dt>
              <dd>{lastRead}</dd>
            </div>
          )}
        </dl>

        <div className="book-detail-progress" aria-hidden={pct <= 0}>
          <div className="book-detail-progress-track">
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>

        {tags.length > 0 && (
          <div className="book-detail-tags" aria-label="Tags">
            {tags.map((t) => (
              <span key={t} className="book-detail-tag">
                {t}
              </span>
            ))}
          </div>
        )}

        {record.source === "local" && (
          <LocalMetadataEditor
            record={record}
            onSaved={onMetadataSaved}
            onFilterTag={onFilterTag}
            onFilterCollection={onFilterCollection}
          />
        )}

        <div className="book-detail-actions">
          <button
            type="button"
            className="book-detail-primary"
            onClick={() => run(actions.onOpen)}
          >
            {started && !finished ? "Resume" : "Open"}
          </button>

          {record.missing && onLocate && (
            <button
              type="button"
              className="book-detail-action locate"
              onClick={() => onLocate(record)}
            >
              Locate missing file…
            </button>
          )}

          <button
            type="button"
            className="book-detail-action"
            onClick={() => run(actions.onToggleFavorite)}
          >
            {record.favorited ? "Unfavorite" : "Favorite"}
          </button>

          {finished ? (
            <button
              type="button"
              className="book-detail-action"
              onClick={() => run(actions.onMarkUnread)}
            >
              Mark as unread
            </button>
          ) : (
            <button
              type="button"
              className="book-detail-action"
              onClick={() => run(actions.onMarkRead)}
            >
              Mark as read
            </button>
          )}

          {started && (
            <button
              type="button"
              className="book-detail-action"
              onClick={() => run(actions.onClearProgress)}
            >
              Clear progress
            </button>
          )}

          {save && actions.onSaveToDevice && (
            <button type="button" className="book-detail-action" onClick={runSave}>
              {ACTION_LABELS.saveToDevice}
            </button>
          )}

          {removeDl && actions.onRemoveDownload && (
            <button
              type="button"
              className="book-detail-action"
              onClick={() => run(actions.onRemoveDownload!)}
            >
              {ACTION_LABELS.removeDownload}
            </button>
          )}

          {removeLocal && actions.onRemoveLocalCopy && (
            <button
              type="button"
              className="book-detail-action danger"
              onClick={() => run(actions.onRemoveLocalCopy!)}
            >
              {ACTION_LABELS.removeLocalCopy}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
