/**
 * Shared loading / offline / error classification for library queries,
 * covers, comic pages, PDF/EPUB open, and downloads.
 *
 * Kind meanings:
 * - `loading` — no content yet; show skeleton or a blocking message
 * - `refreshing` — content is already on screen; background refetch
 * - `ready` — success
 * - `error` — retryable failure with content possibly still useful
 * - `offline` — network unreachable; special copy + retry
 * - `unsupported` — format/capability cannot be used (usually no retry)
 */

import type { ApiError } from "./transport";
import { toApiError } from "./transport";

export type LoadKind =
  | "ready"
  | "loading"
  | "refreshing"
  | "error"
  | "offline"
  | "unsupported";

export interface LoadState {
  kind: LoadKind;
  /** Primary user-facing line. */
  message: string;
  /** Optional secondary detail. */
  detail?: string;
  /** Show a Retry control. Default true for error/offline. */
  canRetry: boolean;
}

export const LOAD_MESSAGES = {
  loadingLibrary: "Loading your library…",
  loadingBook: "Opening book…",
  loadingPdf: "Opening PDF…",
  loadingPage: "Loading page…",
  savingToDevice: "Saving to this device…",
  offline: "You’re offline",
  offlineDetail: "Connect to the network and try again.",
  offlineServer: "Can’t reach your server",
  offlineServerDetail: "Check the connection or open books already on this device.",
  errorGeneric: "Something went wrong",
  errorRetry: "Try again when you’re ready.",
  unsupported: "This format can’t be opened here",
  unsupportedCbr: "CBR files need a server to unpack — save a CBZ, or open from a connected server.",
  unsupportedDetail: "The file type isn’t supported on this device.",
} as const;

/** Transport / network failures that should read as offline, not a hard error.
 *  Note: local/API errors also use `status: 0`, so we require network-ish copy
 *  rather than treating every status-0 as offline. */
export function isOfflineError(err: unknown): boolean {
  if (isUnsupportedError(err)) return false;
  const e = toApiError(err);
  if (e.status === 502 || e.status === 503 || e.status === 504) return true;
  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("cannot reach") ||
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("offline") ||
    msg.includes("err_network") ||
    msg.includes("load failed") ||
    (e.status === 0 && (msg === "" || msg.includes("timeout")))
  );
}

export function isUnsupportedError(err: unknown): boolean {
  const e = toApiError(err);
  const msg = (e.message ?? "").toLowerCase();
  if (e.code === "unsupported") return true;
  return (
    msg.includes("cbr") ||
    msg.includes("can't unpack rar") ||
    msg.includes("cannot unpack rar") ||
    msg.includes("unsupported") ||
    msg.includes("not supported")
  );
}

/** Map any thrown value into a LoadState for UI. */
export function classifyError(err: unknown, context?: "library" | "reader" | "media"): LoadState {
  if (isOfflineError(err)) {
    if (context === "library") {
      return {
        kind: "offline",
        message: LOAD_MESSAGES.offlineServer,
        detail: LOAD_MESSAGES.offlineServerDetail,
        canRetry: true,
      };
    }
    return {
      kind: "offline",
      message: LOAD_MESSAGES.offline,
      detail: LOAD_MESSAGES.offlineDetail,
      canRetry: true,
    };
  }
  if (isUnsupportedError(err)) {
    const e = toApiError(err);
    const msg = (e.message ?? "").toLowerCase();
    const cbr = msg.includes("cbr") || msg.includes("rar");
    return {
      kind: "unsupported",
      message: cbr ? LOAD_MESSAGES.unsupportedCbr : LOAD_MESSAGES.unsupported,
      detail: cbr ? undefined : e.message || LOAD_MESSAGES.unsupportedDetail,
      canRetry: false,
    };
  }
  const e = toApiError(err);
  return {
    kind: "error",
    message: e.message?.trim() || LOAD_MESSAGES.errorGeneric,
    detail: context === "reader" ? LOAD_MESSAGES.errorRetry : undefined,
    canRetry: true,
  };
}

export function loadingState(message: string): LoadState {
  return { kind: "loading", message, canRetry: false };
}

export function readyState(): LoadState {
  return { kind: "ready", message: "", canRetry: false };
}

/**
 * Derive load state from a TanStack Query-like snapshot.
 * Prefer showing existing `hasData` over a blocking error/loading.
 */
export function fromQuery(input: {
  isLoading: boolean;
  isFetching?: boolean;
  isError: boolean;
  error?: unknown;
  hasData: boolean;
  context?: "library" | "reader" | "media";
  loadingMessage?: string;
}): LoadState {
  if (input.isError && !input.hasData) {
    return classifyError(input.error, input.context);
  }
  if (input.isLoading && !input.hasData) {
    return loadingState(input.loadingMessage ?? LOAD_MESSAGES.loadingLibrary);
  }
  if (input.isFetching && input.hasData) {
    return {
      kind: "refreshing",
      message: "",
      canRetry: false,
    };
  }
  if (input.isError && input.hasData) {
    // Stale content stays; caller may show a soft banner.
    return {
      kind: "refreshing",
      message: "",
      detail: "Couldn’t refresh — showing last results.",
      canRetry: true,
    };
  }
  return readyState();
}

/** Human line for a comic page / cover media failure. */
export function mediaFailureState(offline?: boolean): LoadState {
  if (offline) {
    return {
      kind: "offline",
      message: "Page unavailable offline",
      detail: "Reconnect or open a saved copy.",
      canRetry: true,
    };
  }
  return {
    kind: "error",
    message: "Couldn’t load this page",
    canRetry: true,
  };
}

export function formatApiError(err: unknown): ApiError {
  return toApiError(err);
}
