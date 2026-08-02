import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LibraryDatabase } from '../libraryDatabase';
import { FileScannerImpl } from '../fileScanner';
import { IngestService, type IngestFailure } from '../ingestService';
import { COMIC_EXTENSIONS, BOOK_EXTENSIONS } from '../../shared/mediaTypes';

/**
 * @module
 * Bridge Between the Upload Route and the Ingest Service
 *
 * Architecture overview for Junior Devs:
 * The HTTP upload/scan routes need to import files but shouldn't talk to the
 * low-level `IngestService` directly. This module is the adapter in between:
 * it exposes friendly helpers (add a single file, ingest a path with streaming
 * progress) and translates ingest events into something the route can stream
 * back to the browser as it happens.
 */

export const COMIC_EXTS = new Set([...COMIC_EXTENSIONS].map(e => `.${e}`));
export const BOOK_EXTS = new Set([...BOOK_EXTENSIONS].map(e => `.${e}`));

/**
 * Import a single file into the library.
 * @param db The library database facade.
 * @param filePath Absolute path to the comic/book file.
 * @param folderId Optional folder to attach the new item to.
 * @returns Whether it was added, plus an error message if it wasn't.
 */
export async function addSingleFile(
  db: LibraryDatabase,
  filePath: string,
  folderId?: number,
): Promise<{ added: boolean; error?: string }> {
  return new IngestService(db).addFile(filePath, folderId);
}

/** Number of per-file failure examples emitted at the end of a scan. The full
 * list lives in the persistent `ingest_errors` table; we just give the SPA
 * enough to render a useful summary without flooding the wire. */
const FAILURE_SAMPLE_SIZE = 20;

export type IngestEvent =
  | { type: 'progress'; phase: 'comics' | 'books' | 'file'; discovered: number; processed: number; currentFile: string }
  | { type: 'error'; message: string }
  | { type: 'failures-summary'; total: number; byClass: Record<string, number>; sample: IngestFailure[] }
  | { type: 'done'; added: number };

export interface IngestPathOptions {
  folderId?: number;
  useFolderNamesAsSeries?: boolean;
  /** Unix ms timestamp; when set, only directories modified after this time are scanned. */
  since?: number;
  /** Cooperative cancellation — discovery + workers bail when this aborts. */
  signal?: AbortSignal;
}

/**
 * Import a file or directory, emitting progress events as it goes.
 *
 * Used by the upload/scan routes to stream live progress to the browser.
 * Walks the target, ingests supported files, and calls `emit` with progress,
 * error, failure-summary, and a final done event.
 *
 * @param db The library database facade.
 * @param targetPath A file or directory to ingest.
 * @param emit Callback invoked for each progress/error/done event.
 * @param options Folder attachment, series-naming, and incremental `since` filter.
 */
export async function ingestPathStreaming(
  db: LibraryDatabase,
  targetPath: string,
  emit: (event: IngestEvent) => void,
  options: IngestPathOptions = {},
): Promise<void> {
  const { folderId, useFolderNamesAsSeries = false, since, signal } = options;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(targetPath);
  } catch (err) {
    emit({ type: 'error', message: `Cannot access path: ${err instanceof Error ? err.message : String(err)}` });
    emit({ type: 'done', added: 0 });
    return;
  }

  if (stat.isDirectory()) {
    const scanner = new FileScannerImpl(db);
    let added = 0;
    const allFailures: IngestFailure[] = [];
    const scanOpts = { useFolderNamesAsSeries };
    try {
      const r = since != null
        ? await scanner.scanIncremental(targetPath, since, (p) => {
            emit({ type: 'progress', phase: 'comics', discovered: p.discovered, processed: p.processed, currentFile: path.basename(p.currentFile) });
          }, signal, folderId, scanOpts)
        : await scanner.scan(targetPath, (p) => {
            emit({ type: 'progress', phase: 'comics', discovered: p.discovered, processed: p.processed, currentFile: path.basename(p.currentFile) });
          }, signal, folderId, scanOpts);
      added += r.added;
      allFailures.push(...r.failures);
    } catch (err) {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    try {
      const r = since != null
        ? await scanner.scanBooksIncremental(targetPath, since, (p) => {
            emit({ type: 'progress', phase: 'books', discovered: p.discovered, processed: p.processed, currentFile: path.basename(p.currentFile) });
          }, signal, folderId, scanOpts)
        : await scanner.scanBooks(targetPath, (p) => {
            emit({ type: 'progress', phase: 'books', discovered: p.discovered, processed: p.processed, currentFile: path.basename(p.currentFile) });
          }, signal, folderId, scanOpts);
      added += r.added;
      allFailures.push(...r.failures);
    } catch (err) {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    if (allFailures.length > 0) emit(buildFailuresSummary(allFailures));
    emit({ type: 'done', added });
    return;
  }

  if (stat.isFile()) {
    emit({ type: 'progress', phase: 'file', discovered: 1, processed: 0, currentFile: path.basename(targetPath) });
    const result = await addSingleFile(db, targetPath, folderId);
    emit({ type: 'progress', phase: 'file', discovered: 1, processed: 1, currentFile: path.basename(targetPath) });
    if (result.error) emit({ type: 'error', message: `${targetPath}: ${result.error}` });
    emit({ type: 'done', added: result.added ? 1 : 0 });
    return;
  }

  emit({ type: 'error', message: 'Path is not a regular file or directory' });
  emit({ type: 'done', added: 0 });
}

function buildFailuresSummary(failures: IngestFailure[]): IngestEvent {
  const byClass: Record<string, number> = {};
  for (const f of failures) byClass[f.errorClass] = (byClass[f.errorClass] ?? 0) + 1;
  return {
    type: 'failures-summary',
    total: failures.length,
    byClass,
    sample: failures.slice(0, FAILURE_SAMPLE_SIZE),
  };
}
