/**
 * @module
 * Ingest-failure classification.
 *
 * When importing thousands of files, some will fail (corrupt archive, missing
 * file, permission error). This module turns a raw thrown error into a known
 * {@link IngestErrorClass} so failures can be grouped and triaged. The classified
 * failures are *persisted* by the `ingest_errors` DAO ({@link ./db/ingestErrors})
 * — a shared Postgres table read by the admin `/api/admin/ingest-errors` panel.
 *
 * This file is intentionally pure (no DB, no fs) so the hot ingest path and the
 * DAO can both depend on it.
 */

export type IngestErrorClass =
  | 'wasm_oom'        // legacy archive wasm memory failure
  | 'archive_open'    // 7z / archive backend refused to open
  | 'archive_extract' // archive opened, but a page/cover could not extract
  | 'fs_missing'      // ENOENT — file disappeared between scan and ingest
  | 'fs_permission'   // EACCES / EPERM
  | 'timeout'         // cover/page-count timed out
  | 'unknown';

/**
 * Map a raw ingest error into a known error category.
 *
 * Matches the error's message and Node error code against known
 * patterns. Order matters — e.g. WASM out-of-memory messages also contain
 * "out of bounds", so they must be checked first. Unmatched errors return
 * "unknown" (the caller still keeps the raw message).
 *
 * @param err The thrown error (any type).
 * @param filePath The file being processed when it failed (for context).
 * @returns The classified error category.
 */
export function classifyIngestError(err: unknown, filePath: string): IngestErrorClass {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as NodeJS.ErrnoException)?.code;

  if (/out of bounds memory access|RangeError.*WebAssembly|Out of memory|Aborted\(OOM\)/i.test(msg)) {
    return 'wasm_oom';
  }
  if (code === 'ENOENT') return 'fs_missing';
  if (code === 'EACCES' || code === 'EPERM') return 'fs_permission';
  if (/timed out|timeout/i.test(msg)) return 'timeout';
  if (/Unsupported Method|Failed to read page|extract page|failed to extract|Can not open encrypted archive/i.test(msg)) {
    return 'archive_extract';
  }
  if (/Failed to open archive|invalid|corrupt|unexpected end|Bad CRC|RAR.*invalid/i.test(msg)) {
    return 'archive_open';
  }
  // Anything still unclassified is "unknown" — caller still gets the raw message.
  void filePath;
  return 'unknown';
}
