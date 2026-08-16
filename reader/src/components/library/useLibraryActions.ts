/**
 * Library mutations and offline-pin actions.
 *
 * Owns favorite / progress / save-to-device / local-delete / offline pin so
 * Library.tsx can stay focused on layout and query wiring.
 */
import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as api from "../../lib/api";
import { importReportMessage } from "../../lib/format";
import { useDeviceTransfer } from "../../lib/deviceTransfer";
import { useSession } from "../../store/session";
import { invalidateLibrary, patchLibraryCaches } from "./libraryData";

export function useLibraryActions(
  showToast: (msg: string) => void,
  downloads: api.DownloadInfo[] | undefined,
  setShelfChoice: (s: "local" | "server") => void,
  setImporting: (v: boolean) => void,
) {
  const qc = useQueryClient();

  const invalidateAll = useCallback(() => {
    invalidateLibrary(qc);
    qc.invalidateQueries({ queryKey: ["local"] });
  }, [qc]);

  const toggleFavorite = useCallback(
    (r: api.WebComicRecord) => {
      const next = !r.favorited;
      patchLibraryCaches(qc, r.id, { favorited: next });
      api
        .setFavorite(r, next)
        .then(invalidateAll)
        .catch(() => {
          patchLibraryCaches(qc, r.id, { favorited: r.favorited });
          showToast("Couldn't update favorite.");
        });
    },
    [qc, invalidateAll, showToast],
  );

  const markRead = useCallback(
    (r: api.WebComicRecord) => {
      api
        .setCompleted(r, true)
        .then(invalidateAll)
        .catch(() => showToast("Couldn't mark as read."));
    },
    [invalidateAll, showToast],
  );

  const markUnread = useCallback(
    (r: api.WebComicRecord) => {
      api
        .setCompleted(r, false)
        .then(invalidateAll)
        .catch(() => showToast("Couldn't mark as unread."));
    },
    [invalidateAll, showToast],
  );

  const clearProgressAction = useCallback(
    (r: api.WebComicRecord) => {
      api
        .clearProgress(r)
        .then(invalidateAll)
        .catch(() => showToast("Couldn't clear progress."));
    },
    [invalidateAll, showToast],
  );

  const saveToDevice = useCallback(
    (r: api.WebComicRecord) => {
      // Single download-to-device path: full file → on-device shelf.
      // Progress is driven by shelf://local-download-progress → TransferBanner.
      useDeviceTransfer.getState().start(r.id, r.title);
      api
        .localDownload({
          comicId: r.id,
          title: r.title,
          ext: r.fileExt,
          mediaType: r.mediaType,
          pageCount: r.pageCount,
        })
        .then(() => {
          qc.invalidateQueries({ queryKey: ["local"] });
          showToast(`“${r.title}” is on this device.`);
        })
        .catch((err) => {
          const message = api.toApiError(err).message || "Couldn't save to this device.";
          useDeviceTransfer.getState().fail(r.id, message);
          showToast(message);
          window.setTimeout(() => useDeviceTransfer.getState().clear(r.id), 2800);
        });
    },
    [qc, showToast],
  );

  const removeLocalCopy = useCallback(
    (r: api.WebComicRecord) => {
      api
        .localDelete(r.id)
        .then(() => {
          api.forgetLocalBookmarks(r.id);
          qc.invalidateQueries({ queryKey: ["local"] });
          showToast(`Removed local copy of “${r.title}”.`);
        })
        .catch(() => showToast("Couldn't remove the local copy."));
    },
    [qc, showToast],
  );

  const removeOfflineDownload = useCallback(
    (r: api.WebComicRecord) => {
      const pin = (downloads ?? []).find((d) => d.comicId === r.id);
      const cancel = pin?.status === "active" || pin?.status === "queued";
      const op = cancel
        ? api.cancelDownload(r.id).then(() => {
            showToast(`Cancelled download of “${r.title}”.`);
          })
        : api.removeDownload(r.id).then(() => {
            showToast(`Removed offline download of “${r.title}”.`);
          });
      op.then(() => qc.invalidateQueries({ queryKey: ["downloads"] })).catch(() =>
        showToast("Couldn't remove the download."),
      );
    },
    [qc, showToast, downloads],
  );

  const downloadOffline = useCallback(
    (r: api.WebComicRecord) => {
      const pin = (downloads ?? []).find((d) => d.comicId === r.id);
      const resume = !!(pin && !pin.complete && (pin.resumable || pin.done > 0));
      showToast(
        resume
          ? `Resuming offline download of “${r.title}”…`
          : `Downloading “${r.title}” for offline…`,
      );
      api
        .downloadBook({
          comicId: r.id,
          title: r.title,
          mediaType: r.mediaType,
          pageCount: r.pageCount,
        })
        .then(() => qc.invalidateQueries({ queryKey: ["downloads"] }))
        .catch((err) =>
          showToast(api.toApiError(err).message || "Couldn't start offline download."),
        );
    },
    [qc, showToast, downloads],
  );

  const addBooks = useCallback(() => {
    setImporting(true);
    api
      .pickAndImportBooks()
      .then((report) => {
        qc.invalidateQueries({ queryKey: ["local"] });
        const { added, skipped, failed } = report;
        if (added.length) {
          setShelfChoice("local");
          showToast(
            added.length === 1
              ? `Added “${added[0].title}”.`
              : `Added ${added.length} books.`,
          );
        } else if (skipped.length || failed.length) {
          showToast(importReportMessage(report));
        } else {
          showToast("Nothing to add.");
        }
      })
      .catch(() => showToast("Couldn't add those files."))
      .finally(() => setImporting(false));
  }, [qc, showToast, setShelfChoice, setImporting]);

  const addFolder = useCallback(() => {
    setImporting(true);
    const clear = useSession.getState().setImportProgress;
    api
      .pickAndImportFolder()
      .then(({ report }) => {
        qc.invalidateQueries({ queryKey: ["local"] });
        const { added, skipped, failed } = report;
        if (added.length) {
          setShelfChoice("local");
          showToast(
            added.length === 1
              ? `Added “${added[0].title}”.`
              : `Added ${added.length} books.`,
          );
        } else if (skipped.length || failed.length) {
          showToast(importReportMessage(report));
        } else {
          showToast("Nothing to add.");
        }
      })
      .catch(() => showToast("Couldn't add that folder."))
      .finally(() => {
        setImporting(false);
        clear(null);
      });
  }, [qc, showToast, setShelfChoice, setImporting]);

  return {
    invalidateAll,
    toggleFavorite,
    markRead,
    markUnread,
    clearProgressAction,
    saveToDevice,
    removeLocalCopy,
    removeOfflineDownload,
    downloadOffline,
    addBooks,
    addFolder,
  };
}

/** Invalidate shelf caches from outside the hook (tests / rare callers). */
export function invalidateAllShelves(qc: QueryClient): void {
  invalidateLibrary(qc);
  void qc.invalidateQueries({ queryKey: ["local"] });
}
