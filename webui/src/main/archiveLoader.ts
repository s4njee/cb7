/**
 * @module
 * Archive Loader
 * 
 * Architecture overview for Junior Devs:
 * `ArchiveLoader` hides the complexity of dealing with different comic archive formats (.cbz, .cbr).
 * A comic archive is essentially just a renamed ZIP or RAR file containing images.
 * 
 * Why three different backends?
 * 1. CBZ (ZIP) uses `yauzl`: A pure Node.js library. It's fast, doesn't need external binaries, and we can 
 *    keep the ZIP file handle open to extract individual pages quickly during reading.
 * 2. CBR (RAR) uses `unrar`: We spawn the `unrar` CLI binary because it's the fastest and most reliable 
 *    way to extract RAR/RAR5 files.
 * 3. 7-Zip fallback: If `unrar` isn't installed, we fall back to `7z` using the `node-7z` wrapper.
 * 
 * Memory Management:
 * We use a `_pageCache` (LRU cache) to keep recently read pages in memory (up to 64MB per archive).
 * This prevents UI stuttering when a user flips pages back and forth quickly.
 * 
 * unrar binary resolution order:
 *   1. $CB8_UNRAR_PATH env var
 *   2. /usr/bin/unrar
 *   3. /usr/local/bin/unrar
 *   4. `unrar` on $PATH
 *   5. (unavailable — falls back to 7-Zip for CBR)
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yauzl from 'yauzl';
import { selectCoverImage, ImageEntry } from '../shared/coverSelection';
import { decode as decodeImage } from './imageDecoder';
import { assertSevenZipAvailable } from './sevenZipPath';
import {
  archiveBasename,
  archiveExtension,
  archiveImageEntries,
  sevenZipImageEntries,
  type ArchiveEntry,
} from './archiveEntryHelpers';
import {
  createArchivePageCache,
  getCachedArchivePage,
  type ArchivePageCache,
} from './archivePageHelpers';
import {
  readPositiveIntEnv,
  runSevenZip,
  spawnToBuffer,
  type SevenZipStream,
} from './archiveProcessHelpers';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export type { ArchiveEntry } from './archiveEntryHelpers';

export interface ArchiveHandle {
  filePath: string;
  format: 'cbz' | 'cbr';
  entries: ArchiveEntry[];
  pageCount: number;
}

const PAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB per open archive
const LIST_TIMEOUT_MS = readPositiveIntEnv('CB8_ARCHIVE_LIST_TIMEOUT_MS', 60_000);
const EXTRACT_TIMEOUT_MS = readPositiveIntEnv('CB8_ARCHIVE_EXTRACT_TIMEOUT_MS', 30_000);

// ===========================================================================
// yauzl backend (CBZ)
// ===========================================================================

interface YauzlArchiveHandle extends ArchiveHandle {
  readonly _tag: 'yauzl';
  _zipFile: yauzl.ZipFile;
  _entryMap: Map<number, yauzl.Entry>; // page-index → zip entry
  _pageCache: ArchivePageCache;
}

function isYauzlHandle(h: ArchiveHandle): h is YauzlArchiveHandle {
  return (h as YauzlArchiveHandle)._tag === 'yauzl';
}

function openYauzlZip(
  filePath: string,
): Promise<{ zipFile: yauzl.ZipFile; entries: ArchiveEntry[]; entryMap: Map<number, yauzl.Entry> }> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(err ?? new Error(`Failed to open ${filePath}`));
        return;
      }

      const imageItems: { name: string; entry: yauzl.Entry }[] = [];

      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith('/')) {
          imageItems.push({ name: entry.fileName, entry });
        }
        zipFile.readEntry();
      });

      zipFile.on('end', () => {
        const entries = archiveImageEntries(imageItems.map(({ name }) => name));
        const entriesByName = new Map<string, yauzl.Entry[]>();
        for (const { name, entry } of imageItems) {
          const matchingEntries = entriesByName.get(name);
          if (matchingEntries) matchingEntries.push(entry);
          else entriesByName.set(name, [entry]);
        }
        const entryMap = new Map<number, yauzl.Entry>(
          entries.map(({ filename, index }) => [index, entriesByName.get(filename)!.shift()!]),
        );
        resolve({ zipFile, entries, entryMap });
      });

      zipFile.on('error', reject);
      zipFile.readEntry();
    });
  });
}

function readYauzlEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error(`Failed to stream entry: ${entry.fileName}`));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

async function getYauzlPage(handle: YauzlArchiveHandle, pageIndex: number): Promise<Buffer> {
  return getCachedArchivePage(handle._pageCache, pageIndex, handle.pageCount, () => {
    const entry = handle._entryMap.get(pageIndex)!;
    return readYauzlEntry(handle._zipFile, entry);
  });
}

// ===========================================================================
// unrar backend (CBR primary)
// ===========================================================================

interface UnrarArchiveHandle extends ArchiveHandle {
  readonly _tag: 'unrar';
  _unrar: string;
  _pageCache: ArchivePageCache;
}

function isUnrarHandle(h: ArchiveHandle): h is UnrarArchiveHandle {
  return (h as UnrarArchiveHandle)._tag === 'unrar';
}

const UNRAR_SEARCH_PATHS = ['/usr/bin/unrar', '/usr/local/bin/unrar'];
let _unrarBin: string | null | undefined = undefined;

/**
 * Locate the unrar binary. Checks $CB8_UNRAR_PATH, well-known paths, then
 * $PATH. Returns null if unavailable. Result is cached after the first call.
 */
function findUnrarBin(): string | null {
  if (_unrarBin !== undefined) return _unrarBin;

  const fromEnv = process.env.CB8_UNRAR_PATH?.trim();
  if (fromEnv) return (_unrarBin = fromEnv);

  for (const p of UNRAR_SEARCH_PATHS) {
    const r = spawnSync(p, ['--version'], { timeout: 3_000, windowsHide: true });
    if (!r.error) return (_unrarBin = p);
  }

  const r = spawnSync('unrar', ['--version'], { timeout: 3_000, windowsHide: true });
  if (!r.error) return (_unrarBin = 'unrar');

  return (_unrarBin = null);
}

async function listUnrarEntries(filePath: string, unrar: string): Promise<ArchiveEntry[]> {
  const buf = await spawnToBuffer(unrar, ['lb', filePath], { timeout: LIST_TIMEOUT_MS });
  const names = buf
    .toString('utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return archiveImageEntries(names);
}

async function getUnrarPage(handle: UnrarArchiveHandle, pageIndex: number): Promise<Buffer> {
  return getCachedArchivePage(handle._pageCache, pageIndex, handle.pageCount, () => {
    const targetName = handle.entries[pageIndex].filename;
    // `unrar p -inul` prints the file to stdout; -inul suppresses progress noise.
    return spawnToBuffer(
      handle._unrar,
      ['p', '-inul', handle.filePath, targetName],
      { timeout: EXTRACT_TIMEOUT_MS },
    );
  });
}

// ===========================================================================
// 7-Zip backend (CBR fallback + legacy)
// ===========================================================================

type SevenZipRecord = {
  file?: string;
  techInfo?: Map<string, string>;
};

type SevenZipOptions = {
  $bin?: string;
  $cherryPick?: string | string[];
  noWildcards?: boolean;
  overwrite?: string;
  techInfo?: boolean;
  yes?: boolean;
};

type SevenZipModule = {
  list: (archive: string, options?: SevenZipOptions) => SevenZipStream<SevenZipRecord>;
  extract: (archive: string, output: string, options?: SevenZipOptions) => SevenZipStream<SevenZipRecord>;
};

const Seven = require('node-7z') as SevenZipModule;

interface SevenZipArchiveHandle extends ArchiveHandle {
  readonly _tag: '7z';
  _pageCache: ArchivePageCache;
}

function isSevenZipHandle(h: ArchiveHandle): h is SevenZipArchiveHandle {
  return (h as SevenZipArchiveHandle)._tag === '7z';
}

async function listSevenZipEntries(filePath: string): Promise<ArchiveEntry[]> {
  const bin = assertSevenZipAvailable();
  const records = await runSevenZip(
    Seven.list(filePath, { $bin: bin, techInfo: true }),
    `List archive ${filePath}`,
    LIST_TIMEOUT_MS,
  );
  return sevenZipImageEntries(records);
}

async function openSevenZipArchive(filePath: string, format: ArchiveHandle['format']): Promise<SevenZipArchiveHandle> {
  try {
    const entries = await listSevenZipEntries(filePath);
    return {
      filePath, format, _tag: '7z', entries, pageCount: entries.length,
      _pageCache: createArchivePageCache(PAGE_CACHE_MAX_BYTES),
    };
  } catch (err) {
    throw new Error(`Failed to open archive: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function findExtractedFile(tempDir: string, expectedName: string): Promise<string> {
  const expectedPath = path.join(tempDir, expectedName);
  try { await fsp.access(expectedPath); return expectedPath; } catch { /* fall through */ }
  const dirents = await fsp.readdir(tempDir, { withFileTypes: true });
  const files = dirents.filter((d) => d.isFile()).map((d) => d.name);
  if (files.length === 1) return path.join(tempDir, files[0]);
  throw new Error(`extracted file ${expectedName} not found`);
}

async function getSevenZipPage(handle: SevenZipArchiveHandle, pageIndex: number): Promise<Buffer> {
  return getCachedArchivePage(handle._pageCache, pageIndex, handle.pageCount, async () => {
    const targetName = handle.entries[pageIndex].filename;
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cb8-7z-page-'));
    try {
      const bin = assertSevenZipAvailable();
      await runSevenZip(
        Seven.extract(handle.filePath, tempDir, {
          $bin: bin, $cherryPick: targetName, noWildcards: true, overwrite: 'a', yes: true,
        }),
        `Extract page ${pageIndex} from ${handle.filePath}`,
        EXTRACT_TIMEOUT_MS,
      );
      const extractedPath = await findExtractedFile(tempDir, archiveBasename(targetName));
      return fsp.readFile(extractedPath);
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
    }
  });
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Open a CBZ (ZIP) archive using the native yauzl backend.
 */
export async function openCbz(filePath: string): Promise<ArchiveHandle> {
  try {
    const { zipFile, entries, entryMap } = await openYauzlZip(filePath);
    const handle: YauzlArchiveHandle = {
      filePath, format: 'cbz', _tag: 'yauzl',
      _zipFile: zipFile, _entryMap: entryMap,
      entries, pageCount: entries.length,
      _pageCache: createArchivePageCache(PAGE_CACHE_MAX_BYTES),
    };
    return handle;
  } catch (err) {
    throw new Error(`Failed to open archive: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Open a CBR (RAR) archive.
 * Prefers unrar (faster, RAR5-reliable); falls back to 7-Zip if unavailable.
 */
export async function openCbr(filePath: string): Promise<ArchiveHandle> {
  const unrar = findUnrarBin();
  if (unrar) {
    try {
      const entries = await listUnrarEntries(filePath, unrar);
      const handle: UnrarArchiveHandle = {
        filePath, format: 'cbr', _tag: 'unrar', _unrar: unrar,
        entries, pageCount: entries.length,
        _pageCache: createArchivePageCache(PAGE_CACHE_MAX_BYTES),
      };
      return handle;
    } catch (err) {
      console.warn(
        `[CB8] unrar failed for "${path.basename(filePath)}", falling back to 7-Zip: `
        + (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  return openSevenZipArchive(filePath, 'cbr');
}

/**
 * Open a comic archive (CBZ or CBR) by file path.
 */
export async function open(filePath: string): Promise<ArchiveHandle> {
  const ext = archiveExtension(filePath).toLowerCase();
  if (ext === 'cbz') return openCbz(filePath);
  if (ext === 'cbr') return openCbr(filePath);
  throw new Error(`Unsupported file format: .${ext}`);
}

/**
 * Get raw image bytes for a page by index. JXL images are decoded to PNG.
 */
export async function getPage(handle: ArchiveHandle, pageIndex: number): Promise<Buffer> {
  let raw: Buffer;
  if (isYauzlHandle(handle)) {
    raw = await getYauzlPage(handle, pageIndex);
  } else if (isUnrarHandle(handle)) {
    raw = await getUnrarPage(handle, pageIndex);
  } else if (isSevenZipHandle(handle)) {
    raw = await getSevenZipPage(handle, pageIndex);
  } else {
    throw new Error(`Unknown archive backend for format: ${handle.format}`);
  }
  const ext = archiveExtension(handle.entries[pageIndex].filename);
  return decodeImage(raw, ext);
}

/**
 * Get the cover image from an archive.
 */
export async function getCoverImage(handle: ArchiveHandle): Promise<Buffer> {
  const cover = selectCoverImage(
    handle.entries.map((e): ImageEntry => ({ filename: e.filename, index: e.index })),
  );
  if (!cover) throw new Error('No images found in archive');
  return getPage(handle, cover.index);
}

/**
 * Close an archive handle and release resources.
 */
export async function close(handle: ArchiveHandle): Promise<void> {
  if (isYauzlHandle(handle)) {
    handle._zipFile.close();
    handle._pageCache.clear();
  } else if (isUnrarHandle(handle) || isSevenZipHandle(handle)) {
    handle._pageCache.clear();
  }
}
