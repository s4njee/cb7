/**
 * @module
 * Job queue names + payload types for the background worker.
 *
 * The CB8 web server enqueues heavy work (library scans, the ebook search
 * backfill) onto pg-boss queues; the separate worker process drains them. Job
 * payloads live here so the producer (API) and the consumer (worker) agree on
 * shape and can never drift.
 */

/** pg-boss queue names. Kept in one place so producer + worker can't diverge. */
export const QUEUE = {
  /** Walk a path and ingest comics/books (manual add-path + auto-rescan). */
  ingestScan: 'ingest-scan',
  /** (Re)build the ebook semantic-search index for un-indexed books. */
  searchBackfill: 'search-backfill',
  /** FUTURE (not yet wired): OCR a comic's pages → chunk → embed → index. */
  ocrIndex: 'ocr-index',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** Payload for an {@link QUEUE.ingestScan} job. */
export interface IngestScanJob {
  /** Absolute path to a file or directory to ingest. */
  targetPath: string;
  /** Attach newly-added items to this folder, if set. */
  folderId?: number;
  /** Use the first folder below the scan root as the series name. */
  useFolderNamesAsSeries?: boolean;
  /** Unix ms; when set, only directories modified after this are scanned. */
  since?: number;
  /**
   * When set, the worker writes `app_meta` `folder_scan_ts:<folderId>` = this
   * value after a successful scan, so the next incremental rescan resumes from
   * here. Used by the auto-rescan scheduler.
   */
  scanMetaTs?: number;
}

/** Payload for a {@link QUEUE.searchBackfill} job (no fields needed). */
export type SearchBackfillJob = Record<string, never>;

/**
 * FUTURE — not yet implemented. Payload for an OCR-index job: read a comic's
 * pages, OCR them, then chunk → embed → upsert into `ebook_chunks` (reusing the
 * existing ebook-search tail). Designed to be checkpointed per page so it
 * survives worker restarts.
 */
export interface OcrIndexJob {
  comicId: number;
  filePath: string;
}
