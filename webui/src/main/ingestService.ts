import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LibraryDatabase } from './libraryDatabase';
import * as ArchiveLoader from './archiveLoader';
import { extractEpubCover, getEpubSpineCount } from './epubCoverExtractor';
import { getPdfPageCount, renderPdfFirstPageCover } from './pdfCoverExtractor';
import { generateThumbnail } from './thumbnailGenerator';
import { parseSeriesFromFilename, stripLeadingReleaseDate, type SeriesInfo } from './seriesParser';
import { detectMediaType } from '../shared/mediaTypes';
import type { ScanProgress } from '../shared/types';
import { withTimeout } from './utils/timeout';
import { classifyIngestError, type IngestErrorClass } from './ingestErrorLog';
import { dottedExtensionsForMediaType, seriesNameFromScanRoot } from './ingestPathHelpers';
import { IngestQueue } from './ingestQueue';
import { discoverFiles, discoverFilesChangedSince } from './ingestDiscovery';
import { addComicFast, setComicSeries } from './db/comics';
import { addComicsToFolderRaw } from './db/folders';

/**
 * @module
 * Ingest Service
 * 
 * Architecture overview for Junior Devs:
 * The Ingest system is responsible for scanning the file system, finding comic/book files, 
 * and extracting their metadata (page count, covers, series info) to be saved into the database.
 * 
 * Performance is the main driver here:
 * 1. Parallelism: The `IngestQueue` and `runWorkers` methods allow us to extract covers and parse
 *    archives in parallel across multiple concurrent tasks (up to `MAX_INGEST_CONCURRENCY`). 
 * 2. Batching: We don't write to the database one-by-one. We wait until `FLUSH_BATCH_SIZE` items are 
 *    ready and then flush them all inside a single SQLite transaction. This avoids terrible I/O bottlenecks.
 * 3. Incremental Scans: To avoid re-scanning a 10,000 file library, `scanDirectoryIncremental` checks 
 *    the directory's last modified time (`mtime`) and skips parsing files if the directory hasn't changed.
 */
export interface IngestFailure {
  path: string;
  errorClass: IngestErrorClass;
  message: string;
}

const COVER_TIMEOUT_MS = 5000;

// Concurrency for parallel directory scans. Each worker is primarily bound
// by I/O (yauzl reads, sharp encodes) rather than CPU, but running too many
// in parallel causes resource contention on low-spec NAS / container hosts.
// Default is 4; override with CB8_INGEST_CONCURRENCY env var.
const MAX_INGEST_CONCURRENCY = (() => {
  const fromEnv = parseInt(process.env.CB8_INGEST_CONCURRENCY ?? '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 4;
})();

// Flush batched inserts every N prepared records (or at end of run).
const FLUSH_BATCH_SIZE = 200;

export interface IngestResult {
  added: boolean;
  comicId?: number;
  error?: string;
}

export interface ScanDirectoryOptions {
  useFolderNamesAsSeries?: boolean;
}

interface PreparedInsert {
  filePath: string;
  title: string;
  pageCount: number;
  fileSize: number;
  coverThumbnail: Buffer;
  mediaType: 'comic' | 'book';
  seriesInfo: SeriesInfo;
}

export class IngestService {
  constructor(private db: LibraryDatabase) {}

  /**
   * Prepare an insert payload by doing all the slow async I/O (archive
   * open, cover extract, sharp encode, page count). Returns null for
   * dismissed paths, already-indexed files, and unsupported types.
   *
   * Pure async work — does not write to the DB. The caller is responsible
   * for batching the resulting payloads through `flushBatch`.
   */
  async prepareInsert(filePath: string, scanRoot?: string): Promise<PreparedInsert | null> {
    const mediaType = detectMediaType(filePath);
    if (!mediaType) return null;
    if (await this.db.isDismissed(filePath)) return null;
    if (await this.db.comicExistsByPath(filePath)) return null;

    const ext = path.extname(filePath).toLowerCase();
    const stats = fs.statSync(filePath);
    // Strip leading YYYY/YYYYMM/YYYYMMDD prefix from the display title so files
    // like "199305 X-Force v1 022.cbz" show as "X-Force v1 022".
    const title = stripLeadingReleaseDate(path.basename(filePath, ext));
    const seriesInfo = parseSeriesFromFilename(path.basename(filePath));

    if (scanRoot) {
      const seriesName = seriesNameFromScanRoot(scanRoot, filePath);
      if (seriesName) seriesInfo.seriesName = seriesName;
    }

    if (mediaType === 'book') {
      let pageCount = 0;
      if (ext === '.pdf') {
        try { pageCount = await withTimeout(getPdfPageCount(filePath), COVER_TIMEOUT_MS); } catch { /* ignore */ }
      } else if (ext === '.epub') {
        try { pageCount = await withTimeout(getEpubSpineCount(filePath), COVER_TIMEOUT_MS); } catch { /* ignore */ }
      }
      let coverThumbnail: Buffer;
      try {
        const raw = ext === '.epub'
          ? await withTimeout(extractEpubCover(filePath), COVER_TIMEOUT_MS)
          : ext === '.pdf'
            ? await withTimeout(renderPdfFirstPageCover(filePath), COVER_TIMEOUT_MS)
            : null;
        coverThumbnail = ext === '.epub'
          ? await generateThumbnail(raw)
          : (raw ?? await generateThumbnail(null));
      } catch {
        coverThumbnail = await generateThumbnail(null);
      }
      return { filePath, title, pageCount, fileSize: stats.size, coverThumbnail, mediaType: 'book', seriesInfo };
    }

    // Comic archive
    const handle = await ArchiveLoader.open(filePath);
    try {
      let coverImage: Buffer | null = null;
      try {
        coverImage = await ArchiveLoader.getCoverImage(handle);
      } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).trim();
        const errorClass = classifyIngestError(err, filePath);
        // Best-effort: a logging failure must never break the ingest.
        await this.db.recordIngestError({ path: filePath, ext, errorClass, message }).catch(() => {});
        console.warn(`Failed to extract cover from ${filePath} [${errorClass}]; using placeholder thumbnail.`, err);
      }
      const coverThumbnail = await generateThumbnail(coverImage);
      return {
        filePath, title, pageCount: handle.pageCount, fileSize: stats.size,
        coverThumbnail, mediaType: 'comic', seriesInfo,
      };
    } finally {
      await ArchiveLoader.close(handle);
    }
  }

  async flushBatch(batch: PreparedInsert[], folderId?: number): Promise<number[]> {
    if (batch.length === 0) return [];
    const ids: number[] = [];
    await this.db.runInTransaction(async (tx) => {
      for (const p of batch) {
        const id = await addComicFast(tx, {
          filePath: p.filePath, title: p.title, pageCount: p.pageCount, fileSize: p.fileSize,
          coverThumbnail: p.coverThumbnail, mediaType: p.mediaType,
        });
        if (p.seriesInfo.seriesName) {
          await setComicSeries(tx, id, p.seriesInfo.seriesName, p.seriesInfo.volumeNumber, p.seriesInfo.chapterNumber);
        }
        ids.push(id);
      }
      if (folderId != null && ids.length > 0) {
        await addComicsToFolderRaw(tx, folderId, ids);
      }
    });
    return ids;
  }

  /**
   * Single-file ingest used by the upload route. Wraps prepare + flush
   * for one file; returns added/comicId/error in the original shape.
   */
  async addFile(filePath: string, folderId?: number): Promise<IngestResult> {
    try {
      const prepared = await this.prepareInsert(filePath);
      if (!prepared) {
        if (!detectMediaType(filePath)) return { added: false, error: 'Unsupported file type' };
        return { added: false };
      }
      const [id] = await this.flushBatch([prepared], folderId);
      return { added: true, comicId: id };
    } catch (err) {
      return { added: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Parallel ingest of a discovered file list. Runs `MAX_INGEST_CONCURRENCY`
   * preparers concurrently and flushes batches of `FLUSH_BATCH_SIZE` to the
   * DB in single transactions. Returns the count of newly-inserted rows.
   *
   * Existing-on-disk hits (`comicExistsByPath`) and dismissed paths are
   * skipped silently. If `folderId` is set, existing items also get
   * attached to the folder so re-running an add-path with a folder is
   * additive. `scanRoot` is intentionally opt-in; when supplied, the first
   * folder below that root is written as the series name.
   */
  async ingestParallel(
    filePaths: string[],
    onProgress: (progress: ScanProgress) => void,
    signal?: AbortSignal,
    folderId?: number,
    scanRoot?: string,
  ): Promise<{ added: number; failures: IngestFailure[] }> {
    const queue = new IngestQueue();
    queue.pushMany(filePaths);
    queue.complete();
    return this.runWorkers(queue, onProgress, signal, folderId, scanRoot);
  }

  private async runWorkers(
    queue: IngestQueue,
    onProgress: (progress: ScanProgress) => void,
    signal: AbortSignal | undefined,
    folderId: number | undefined,
    scanRoot: string | undefined,
  ): Promise<{ added: number; failures: IngestFailure[] }> {
    const progress: ScanProgress = { discovered: 0, processed: 0, currentFile: '' };
    const pending: PreparedInsert[] = [];
    const existingForFolder: number[] = [];
    const failures: IngestFailure[] = [];
    let added = 0;
    let lastEmit = 0;
    let emittedCurrentFile = false;

    const emit = (force = false): void => {
      progress.discovered = queue.totalSeen();
      const now = Date.now();
      if (!force && now - lastEmit < 50) return;
      lastEmit = now;
      onProgress({ ...progress });
    };

    const flushIfFull = async (): Promise<void> => {
      if (pending.length >= FLUSH_BATCH_SIZE) {
        added += (await this.flushBatch(pending.splice(0, pending.length), folderId)).length;
      }
      if (folderId != null && existingForFolder.length >= FLUSH_BATCH_SIZE) {
        const ids = existingForFolder.splice(0, existingForFolder.length);
        await this.db.runInTransaction((tx) => addComicsToFolderRaw(tx, folderId, ids));
      }
    };

    const worker = async (): Promise<void> => {
      while (true) {
        if (signal?.aborted) return;
        const filePath = await queue.shift();
        if (filePath === null) return; // queue closed and drained
        progress.currentFile = filePath;
        emit(!emittedCurrentFile);
        emittedCurrentFile = true;
        try {
          if (await this.db.comicExistsByPath(filePath)) {
            const existing = await this.db.getComicByPath(filePath);
            if (existing) {
              if (folderId != null) {
                existingForFolder.push(existing.id);
              } else if (scanRoot) {
                const seriesName = seriesNameFromScanRoot(scanRoot, filePath);
                const metadata = await this.db.getComicMetadata(existing.id);
                if (seriesName && metadata?.seriesName !== seriesName) {
                  await this.db.setComicSeries(
                    existing.id,
                    seriesName,
                    metadata?.volumeNumber ?? null,
                    metadata?.chapterNumber ?? null,
                  );
                }
              }
            }
          } else {
            const prep = await this.prepareInsert(filePath, scanRoot);
            if (prep) pending.push(prep);
          }
          await flushIfFull();
        } catch (err) {
          // Track and persist the failure so the user can see exactly which
          // files dropped and why. Going to console alone (the old behavior)
          // made a 26k-of-40k delta impossible to triage.
          const message = (err instanceof Error ? err.message : String(err)).trim();
          const errorClass = classifyIngestError(err, filePath);
          const ext = (filePath.match(/\.[^./\\]+$/)?.[0] ?? '').toLowerCase();
          const failure: IngestFailure = { path: filePath, errorClass, message };
          failures.push(failure);
          // Best-effort: a logging failure must never break the ingest.
          await this.db.recordIngestError({ path: filePath, ext, errorClass, message }).catch(() => {});
          console.error(`Failed to process ${filePath} [${errorClass}]:`, err);
        }
        progress.processed++;
        emit();
      }
    };

    emit(true);

    const workers: Promise<void>[] = [];
    for (let i = 0; i < MAX_INGEST_CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);

    if (pending.length > 0) {
      added += (await this.flushBatch(pending.splice(0, pending.length), folderId)).length;
    }
    if (folderId != null && existingForFolder.length > 0) {
      await this.db.runInTransaction((tx) => addComicsToFolderRaw(tx, folderId, existingForFolder));
    }
    emit(true);
    return { added, failures };
  }

  async scanDirectory(
    dirPath: string,
    mediaType: 'comic' | 'book',
    onProgress: (progress: ScanProgress) => void,
    signal?: AbortSignal,
    folderId?: number,
    options: ScanDirectoryOptions = {},
  ): Promise<{ added: number; failures: IngestFailure[] }> {
    const extensions = dottedExtensionsForMediaType(mediaType);

    const files: string[] = [];
    await discoverFiles(dirPath, files, extensions, signal);
    if (signal?.aborted) return { added: 0, failures: [] };
    const metadataRoot = options.useFolderNamesAsSeries === true ? dirPath : undefined;
    return this.ingestParallel(files, onProgress, signal, folderId, metadataRoot);
  }

  /**
   * Incremental variant: only discovers files inside directories whose mtime
   * is newer than `since` (Unix ms). Directories with an older mtime are still
   * traversed to find changed sub-directories, but their files are skipped —
   * this avoids O(all-files) DB lookups when a large library hasn't changed.
   */
  async scanDirectoryIncremental(
    dirPath: string,
    mediaType: 'comic' | 'book',
    onProgress: (progress: ScanProgress) => void,
    since: number,
    signal?: AbortSignal,
    folderId?: number,
    options: ScanDirectoryOptions = {},
  ): Promise<{ added: number; failures: IngestFailure[] }> {
    const extensions = dottedExtensionsForMediaType(mediaType);

    const files: string[] = [];
    await discoverFilesChangedSince(dirPath, files, extensions, since, signal);
    if (signal?.aborted) return { added: 0, failures: [] };
    const metadataRoot = options.useFolderNamesAsSeries === true ? dirPath : undefined;
    return this.ingestParallel(files, onProgress, signal, folderId, metadataRoot);
  }
}
