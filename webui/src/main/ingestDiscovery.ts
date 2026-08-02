import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

/**
 * @module
 * Ingest Discovery Helpers
 *
 * Architecture overview for Junior Devs:
 * These helpers do the filesystem walk for library scans. They do not parse
 * archives, read covers, or write to the database; they only collect file paths
 * whose extensions match the requested media type. Keeping discovery separate
 * from `IngestService` makes the ingest flow easier to follow and lets us test
 * recursive scan behavior with tiny temporary folders.
 */

async function collectFilesInDirectory(
  dirPath: string,
  files: string[],
  extensions: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  const dir = await fsp.opendir(dirPath);
  for await (const entry of dir) {
    if (signal?.aborted) break;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await discoverFiles(fullPath, files, extensions, signal);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
}

export async function discoverFiles(
  dirPath: string,
  files: string[],
  extensions: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  try {
    await collectFilesInDirectory(dirPath, files, extensions, signal);
  } catch (err) {
    console.error(`Failed to open directory ${dirPath}:`, err);
  }
}

async function collectFilesChangedSinceInDirectory(
  dirPath: string,
  files: string[],
  extensions: Set<string>,
  since: number,
  signal?: AbortSignal,
): Promise<void> {
  const dirStat = await fsp.stat(dirPath);
  const dirChanged = dirStat.mtimeMs > since;
  const dir = await fsp.opendir(dirPath);
  for await (const entry of dir) {
    if (signal?.aborted) break;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await discoverFilesChangedSince(fullPath, files, extensions, since, signal);
    } else if (dirChanged && entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
}

export async function discoverFilesChangedSince(
  dirPath: string,
  files: string[],
  extensions: Set<string>,
  since: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  try {
    await collectFilesChangedSinceInDirectory(dirPath, files, extensions, since, signal);
  } catch (err) {
    console.error(`Failed to open directory ${dirPath}:`, err);
  }
}
