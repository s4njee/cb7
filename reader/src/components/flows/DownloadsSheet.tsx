/** Offline downloads manager: pin lifecycle (queued / active / paused / failed /
 *  complete), stable progress labels, resume-on-retry, and restart recovery copy. */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../../lib/api";
import { CloseIcon } from "../icons";
import { ACTION_LABELS } from "../../lib/bookContext";
import {
  canCancelDownload,
  canRetryDownload,
  progressDetail,
  progressPercent,
  resolveDownloadStatus,
  statusLabel,
} from "../../lib/downloadStatus";
import { useSession } from "../../store/session";

const KEY = ["downloads"] as const;
/** Don't re-render the list more than this often for pure byte-noise updates. */
const PROGRESS_THROTTLE_MS = 280;

function glyph(mediaType: api.DownloadInfo["mediaType"]): string {
  return mediaType === "comic" ? "▤" : "❏";
}

function Row({
  info,
  onCancel,
  onRemove,
  onRetry,
}: {
  info: api.DownloadInfo;
  onCancel: (id: number) => void;
  onRemove: (id: number) => void;
  onRetry: (info: api.DownloadInfo) => void;
}) {
  const status = resolveDownloadStatus(info);
  const pct = progressPercent(info);
  const label = statusLabel(status, info);
  const detail = progressDetail(info);

  return (
    <div className={`dl-row status-${status}`}>
      <span className="dl-glyph" aria-hidden="true">
        {glyph(info.mediaType)}
      </span>
      <div className="dl-main">
        <div className="dl-title">{info.title}</div>
        <div className="dl-status-row">
          <span className={`dl-status-pill status-${status}`}>{label}</span>
        </div>
        <div className="dl-sub">{detail}</div>
        <div
          className={status === "complete" ? "dl-track-slot" : "dl-track"}
          aria-hidden={status === "complete"}
        >
          {status !== "complete" && pct != null && (
            <div style={{ width: `${pct}%` }} />
          )}
        </div>
      </div>
      <div className="dl-actions">
        {canCancelDownload(info) && (
          <button type="button" className="dl-action" onClick={() => onCancel(info.comicId)}>
            {ACTION_LABELS.cancelDownload}
          </button>
        )}
        {canRetryDownload(info) && (
          <button type="button" className="dl-action primary" onClick={() => onRetry(info)}>
            Retry
          </button>
        )}
        {(status === "complete" || status === "paused" || status === "failed") && (
          <button type="button" className="dl-action" onClick={() => onRemove(info.comicId)}>
            {ACTION_LABELS.removeDownload}
          </button>
        )}
      </div>
    </div>
  );
}

export default function DownloadsSheet() {
  const closeSheet = useSession((s) => s.closeSheet);
  const showToast = useSession((s) => s.showToast);
  const qc = useQueryClient();
  const lastFlush = useRef(0);
  const pending = useRef<Map<number, api.DownloadProgress>>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useQuery({
    queryKey: KEY,
    queryFn: () => api.listDownloads(),
    staleTime: 0,
  });
  const downloads = query.data ?? [];

  const applyProgress = (p: api.DownloadProgress) => {
    qc.setQueryData<api.DownloadInfo[]>(KEY, (prev) => {
      const list = prev ? [...prev] : [];
      const idx = list.findIndex((d) => d.comicId === p.comicId);
      const next: api.DownloadInfo = {
        comicId: p.comicId,
        title: p.title,
        mediaType: p.mediaType,
        total: p.total,
        done: p.done,
        bytes: p.bytes,
        complete: p.complete,
        status: p.status,
        lastError: p.error ?? p.lastError ?? null,
        resumable: p.resumable,
      };
      if (idx >= 0) list[idx] = next;
      else list.push(next);
      return list;
    });
  };

  const flushPending = () => {
    flushTimer.current = null;
    lastFlush.current = Date.now();
    for (const p of pending.current.values()) applyProgress(p);
    pending.current.clear();
  };

  // Merge live progress events; throttle pure progress ticks so labels don't jitter.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void api
      .onDownloadProgress((p) => {
        const status = p.status ?? (p.complete ? "complete" : p.error ? "failed" : "active");
        const terminal =
          status === "complete" ||
          status === "failed" ||
          status === "paused" ||
          !!p.error;

        if (terminal) {
          pending.current.delete(p.comicId);
          applyProgress({ ...p, status });
          if (p.error && !/cancel/i.test(p.error)) {
            showToast(`Download failed: ${p.title}`);
          } else if (p.complete) {
            showToast(`“${p.title}” is available offline.`);
          }
          return;
        }

        pending.current.set(p.comicId, { ...p, status });
        const now = Date.now();
        if (now - lastFlush.current >= PROGRESS_THROTTLE_MS) {
          flushPending();
        } else if (!flushTimer.current) {
          flushTimer.current = setTimeout(
            flushPending,
            PROGRESS_THROTTLE_MS - (now - lastFlush.current),
          );
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, showToast]);

  const onCancel = async (id: number) => {
    try {
      await api.cancelDownload(id);
    } catch {
      /* best-effort */
    }
    void query.refetch();
  };

  const onRemove = async (id: number) => {
    try {
      await api.removeDownload(id);
      qc.setQueryData<api.DownloadInfo[]>(KEY, (prev) =>
        (prev ?? []).filter((d) => d.comicId !== id),
      );
    } catch {
      showToast("Couldn’t remove the offline download.");
    }
    void query.refetch();
  };

  const onRetry = async (info: api.DownloadInfo) => {
    try {
      showToast(
        info.resumable || info.done > 0
          ? `Resuming “${info.title}” from where it left off…`
          : `Retrying “${info.title}”…`,
      );
      await api.downloadBook({
        comicId: info.comicId,
        title: info.title,
        mediaType: info.mediaType,
        pageCount: info.total > 0 ? info.total : info.mediaType === "comic" ? 1 : 1,
      });
      void query.refetch();
    } catch (err) {
      showToast(api.toApiError(err).message || "Couldn't retry download.");
    }
  };

  const incomplete = downloads.filter((d) => !d.complete);
  const showResumeHint = incomplete.some(
    (d) => resolveDownloadStatus(d) === "paused" || resolveDownloadStatus(d) === "failed",
  );

  return (
    <div className="sheet">
      <div className="sheet-head">
        <div className="drawer-title">Downloads</div>
        <button className="close-btn" onClick={closeSheet} aria-label="Close">
          <CloseIcon size={17} />
        </button>
      </div>

      <div className="sheet-body">
        {showResumeHint && (
          <div className="dl-resume-banner" role="status">
            Incomplete downloads keep partial files. <strong>Retry</strong> continues
            from the last finished unit — nothing is discarded.
          </div>
        )}

        {downloads.length === 0 ? (
          <div className="stats-empty">
            No leftover offline pins.
            {api.localSupported ? (
              <>
                <br />
                To keep a book on this device, open its details and choose{" "}
                <strong>Save to device</strong>. Opening an EPUB or PDF from the
                server does the same automatically — progress shows at the bottom
                of the screen.
              </>
            ) : (
              <>
                <br />
                Downloads are available in the CB8 app.
              </>
            )}
          </div>
        ) : (
          <div className="dl-list">
            {downloads.map((d) => (
              <Row
                key={d.comicId}
                info={d}
                onCancel={onCancel}
                onRemove={onRemove}
                onRetry={onRetry}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
