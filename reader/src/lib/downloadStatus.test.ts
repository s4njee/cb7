import {
  canCancelDownload,
  canRetryDownload,
  formatDownloadBytes,
  progressDetail,
  resolveDownloadStatus,
  statusLabel,
  type DownloadLike,
} from "./downloadStatus";

function d(partial: Partial<DownloadLike>): DownloadLike {
  return {
    comicId: 1,
    title: "T",
    mediaType: "comic",
    total: 10,
    done: 0,
    bytes: 0,
    complete: false,
    ...partial,
  };
}

export interface DlVector {
  name: string;
  run: () => void;
}

export const DOWNLOAD_STATUS_VECTORS: DlVector[] = [
  {
    name: "formatDownloadBytes rounds",
    run: () => {
      if (formatDownloadBytes(0) !== "0 MB") throw new Error("zero");
      if (formatDownloadBytes(50_000) !== "< 0.1 MB") throw new Error("tiny");
      if (formatDownloadBytes(1.24 * 1024 * 1024) !== "1.2 MB") throw new Error("1.2");
    },
  },
  {
    name: "resolve complete",
    run: () => {
      if (resolveDownloadStatus(d({ complete: true, status: "complete" })) !== "complete") {
        throw new Error("complete");
      }
    },
  },
  {
    name: "failed vs paused from cancel text",
    run: () => {
      if (resolveDownloadStatus(d({ lastError: "Download cancelled" })) !== "paused") {
        throw new Error("cancel");
      }
      if (resolveDownloadStatus(d({ lastError: "Server returned 500" })) !== "failed") {
        throw new Error("fail");
      }
    },
  },
  {
    name: "statusLabel resume copy",
    run: () => {
      const s = statusLabel("paused", d({ done: 3, resumable: true }));
      if (!s.toLowerCase().includes("resume")) throw new Error(s);
    },
  },
  {
    name: "progressDetail includes pages and size",
    run: () => {
      const line = progressDetail(
        d({ done: 3, total: 12, bytes: 2 * 1024 * 1024, status: "active" }),
      );
      if (!line.includes("3 of 12 pages") || !line.includes("2.0 MB")) {
        throw new Error(line);
      }
    },
  },
  {
    name: "canRetry only paused/failed",
    run: () => {
      if (!canRetryDownload(d({ status: "paused" }))) throw new Error("paused");
      if (!canRetryDownload(d({ status: "failed", lastError: "x" }))) throw new Error("failed");
      if (canRetryDownload(d({ status: "active" }))) throw new Error("active");
      if (canCancelDownload(d({ status: "complete", complete: true }))) {
        throw new Error("complete cancel");
      }
    },
  },
];

export function runDownloadStatusVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of DOWNLOAD_STATUS_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `downloadStatus: ${DOWNLOAD_STATUS_VECTORS.length} ok`
      : `downloadStatus: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
