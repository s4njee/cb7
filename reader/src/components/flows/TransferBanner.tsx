/** Global “Save to device” progress — one path, one bar.
 *
 * Listens for `local_download` progress (detail-sheet Save, PDF/EPUB open-time
 * copy) and shows a compact strip so downloads never look stuck with only a toast.
 */
import { useEffect } from "react";
import * as api from "../../lib/api";
import {
  activeTransfers,
  formatTransferBytes,
  transferPercent,
  useDeviceTransfer,
} from "../../lib/deviceTransfer";

export default function TransferBanner() {
  const byId = useDeviceTransfer((s) => s.byId);
  const progress = useDeviceTransfer((s) => s.progress);
  const clear = useDeviceTransfer((s) => s.clear);
  const items = activeTransfers(byId);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void api
      .onLocalDownloadProgress((p) => {
        const prev = useDeviceTransfer.getState().byId[p.comicId];
        // Ignore terminal events for transfers we never started (e.g. silent
        // open-time cache hits after the reader already unmounted its start).
        if (!prev && p.done) return;
        progress({
          comicId: p.comicId,
          received: p.received,
          total: p.total,
          done: p.done,
        });
        if (p.done) {
          // Cache hit (already on device): dismiss immediately — no bar flash.
          // Real download: hold the full bar briefly so progress feels complete.
          const streamed =
            (prev?.received ?? 0) > 0 || p.received > 64 * 1024;
          window.setTimeout(() => clear(p.comicId), streamed ? 1400 : 0);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [progress, clear]);

  if (!items.length) return null;

  return (
    <div className="transfer-stack" role="status" aria-live="polite">
      {items.map((t) => {
        const pct = transferPercent(t);
        const label = t.error
          ? `Couldn’t save “${t.title}”`
          : t.done
            ? `“${t.title}” saved`
            : `Saving “${t.title}”…`;
        return (
          <div key={t.comicId} className={`transfer-banner${t.error ? " error" : ""}`}>
            <div className="transfer-banner-head">
              <span className="transfer-banner-title">{label}</span>
              <span className="transfer-banner-meta">
                {t.error
                  ? t.error
                  : pct != null
                    ? `${pct}% · ${formatTransferBytes(t.received, t.total)}`
                    : formatTransferBytes(t.received, t.total)}
              </span>
            </div>
            <div className="transfer-banner-track" aria-hidden="true">
              <div
                className={pct == null && !t.done ? "indeterminate" : undefined}
                style={pct != null ? { width: `${pct}%` } : t.done ? { width: "100%" } : undefined}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
