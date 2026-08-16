import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverFiles, discoverFilesChangedSince } from './ingestDiscovery';
import { dottedExtensionsForMediaType } from './ingestPathHelpers';

let tempRoot: string;

async function writeFixture(relativePath: string): Promise<string> {
  const fullPath = path.join(tempRoot, relativePath);
  await fsp.mkdir(path.dirname(fullPath), { recursive: true });
  await fsp.writeFile(fullPath, 'fixture');
  return fullPath;
}

describe('ingestDiscovery', () => {
  beforeEach(async () => {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cb8-ingest-discovery-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });

  it('recursively discovers files with accepted extensions', async () => {
    const rootComic = await writeFixture('Issue 001.CBZ');
    const nestedComic = await writeFixture(path.join('Series', 'Issue 002.cbr'));
    await writeFixture('notes.txt');

    const files: string[] = [];
    await discoverFiles(tempRoot, files, new Set(['.cbz', '.cbr']));

    expect(files.sort()).toEqual([rootComic, nestedComic].sort());
  });

  it('does not add files after an already-aborted signal', async () => {
    await writeFixture('Issue 001.cbz');
    const controller = new AbortController();
    controller.abort();

    const files: string[] = [];
    await discoverFiles(tempRoot, files, new Set(['.cbz']), controller.signal);

    expect(files).toEqual([]);
  });

  it('keeps walking nested directories during incremental discovery', async () => {
    const oldFile = await writeFixture(path.join('Old Series', 'Issue 001.cbz'));
    const newFile = await writeFixture(path.join('New Series', 'Issue 002.cbz'));
    await writeFixture(path.join('New Series', 'notes.txt'));

    const oldTime = new Date('2024-01-01T00:00:00.000Z');
    const newTime = new Date('2024-01-03T00:00:00.000Z');
    const since = new Date('2024-01-02T00:00:00.000Z').getTime();

    await fsp.utimes(path.dirname(oldFile), oldTime, oldTime);
    await fsp.utimes(path.dirname(newFile), newTime, newTime);
    await fsp.utimes(tempRoot, oldTime, oldTime);

    const files: string[] = [];
    await discoverFilesChangedSince(tempRoot, files, new Set(['.cbz']), since);

    expect(files).toEqual([newFile]);
  });

  it('logs and continues when a directory cannot be opened', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const files: string[] = [];

    await discoverFiles(path.join(tempRoot, 'missing'), files, new Set(['.cbz']));

    expect(files).toEqual([]);
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Folder-comics (P1-6): a directory of loose image files is ONE comic.
  // ---------------------------------------------------------------------------

  it('treats a directory of loose images as a single folder-comic', async () => {
    await writeFixture('01.jpg');
    await writeFixture('02.png');
    await writeFixture('03.png');

    const files: string[] = [];
    await discoverFiles(tempRoot, files, dottedExtensionsForMediaType('comic'));

    // Exactly the directory itself — the loose images are never emitted.
    expect(files).toEqual([tempRoot]);
  });

  it('does not treat a folder that holds a .cbz as a folder-comic', async () => {
    const cbz = await writeFixture('a.cbz');
    await writeFixture('cover.jpg');

    const files: string[] = [];
    await discoverFiles(tempRoot, files, dottedExtensionsForMediaType('comic'));

    // The .cbz disqualifies the folder; the archive is what gets scanned.
    expect(files).toEqual([cbz]);
  });

  it('does not treat a folder that holds a .pdf as a folder-comic (full-media disqualifier)', async () => {
    await writeFixture('b.pdf');
    await writeFixture('img.jpg');

    const files: string[] = [];
    await discoverFiles(tempRoot, files, dottedExtensionsForMediaType('comic'));

    // The direct .pdf disqualifies the folder even during a comic scan (the
    // disqualifier is the FULL media set, not the scan's extensions). A comic
    // scan does not pick the .pdf up either, so nothing is emitted.
    expect(files).toEqual([]);
  });

  it('emits image-only subdirectories as separate folder-comics but not the root', async () => {
    await writeFixture(path.join('ch1', '001.jpg'));
    await writeFixture(path.join('ch2', '001.png'));
    const ch1 = path.join(tempRoot, 'ch1');
    const ch2 = path.join(tempRoot, 'ch2');

    const files: string[] = [];
    await discoverFiles(tempRoot, files, dottedExtensionsForMediaType('comic'));

    expect(files).not.toContain(tempRoot);
    expect(files.sort()).toEqual([ch1, ch2].sort());
  });

  it('discoverFilesChangedSince only emits a folder-comic when its mtime is newer than since', async () => {
    await writeFixture('01.jpg');
    const dirTime = new Date('2024-01-03T00:00:00.000Z');
    await fsp.utimes(tempRoot, dirTime, dirTime);

    // `since` before the folder's mtime → it changed → the folder is emitted.
    const oldFiles: string[] = [];
    await discoverFilesChangedSince(
      tempRoot, oldFiles, dottedExtensionsForMediaType('comic'),
      new Date('2024-01-02T00:00:00.000Z').getTime(),
    );
    expect(oldFiles).toEqual([tempRoot]);

    // `since` after the folder's mtime → unchanged → the folder is skipped.
    const newFiles: string[] = [];
    await discoverFilesChangedSince(
      tempRoot, newFiles, dottedExtensionsForMediaType('comic'),
      new Date('2024-01-04T00:00:00.000Z').getTime(),
    );
    expect(newFiles).toEqual([]);
  });
});
