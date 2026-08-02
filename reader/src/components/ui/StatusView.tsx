/**
 * Shared loading / offline / error / unsupported UI.
 *
 * - `StatusView` — full block (library empty area, blocking reader surface)
 * - `StatusOverlay` — absolute overlay; only when no readable content remains
 * - `MediaPlaceholder` — inline page/cover failure with optional retry
 * - `ContentSkeleton` — library grid skeleton for first load
 */
import type { LoadState } from "../../lib/loadState";

export function StatusView({
  state,
  onRetry,
  compact,
}: {
  state: LoadState;
  onRetry?: () => void;
  compact?: boolean;
}) {
  if (state.kind === "ready" || state.kind === "refreshing") return null;
  const showRetry = state.canRetry && onRetry;
  return (
    <div
      className={`status-view status-${state.kind}${compact ? " compact" : ""}`}
      role={state.kind === "loading" ? "status" : "alert"}
    >
      {state.kind === "loading" && <div className="status-spinner" aria-hidden="true" />}
      <div className="status-message">{state.message}</div>
      {state.detail && <div className="status-detail">{state.detail}</div>}
      {showRetry && (
        <button type="button" className="retry-btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Blocking overlay for readers — only when nothing useful is painted.
 *  Pass `percent` (0–100) while saving/opening a full file so the bar moves. */
export function StatusOverlay({
  state,
  onRetry,
  percent,
}: {
  state: LoadState;
  onRetry?: () => void;
  /** Download / save progress when known; omit or null for spinner-only. */
  percent?: number | null;
}) {
  if (state.kind === "ready" || state.kind === "refreshing") return null;
  const showBar = state.kind === "loading" && percent != null;
  return (
    <div className={`reader-message status-overlay status-${state.kind}${state.canRetry ? " reader-error" : ""}`}>
      {state.kind === "loading" && !showBar && (
        <div className="status-spinner" aria-hidden="true" />
      )}
      <span className="status-message">{state.message}</span>
      {state.detail && <span className="status-detail">{state.detail}</span>}
      {state.kind === "loading" && (
        <div
          className={`status-progress-track${showBar ? "" : " indeterminate"}`}
          aria-hidden="true"
        >
          <div style={showBar ? { width: `${Math.min(100, Math.max(0, percent))}%` } : undefined} />
        </div>
      )}
      {state.canRetry && onRetry && (
        <button type="button" className="retry-btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Soft banner when stale content is shown after a failed refresh. */
export function StatusBanner({
  text,
  onRetry,
}: {
  text: string;
  onRetry?: () => void;
}) {
  return (
    <div className="status-banner" role="status">
      <span>{text}</span>
      {onRetry && (
        <button type="button" className="status-banner-retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function MediaPlaceholder({
  label,
  failed,
  offline,
  onRetry,
}: {
  label: string;
  failed?: boolean;
  offline?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className={`media-placeholder${failed ? " failed" : ""}`}>
      <span className="media-placeholder-label">{label}</span>
      {failed && (
        <div className="media-placeholder-actions">
          <span className="media-placeholder-hint">
            {offline ? "Unavailable offline" : "Couldn’t load"}
          </span>
          {onRetry && (
            <button type="button" className="media-retry" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** First-load library grid skeleton — not used when prior data exists. */
export function ContentSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid content-skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-card">
          <div className="skeleton-cover" />
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </div>
      ))}
    </div>
  );
}
