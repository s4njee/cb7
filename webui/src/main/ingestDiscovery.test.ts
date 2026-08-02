import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverFiles, discoverFilesChangedSince } from './ingestDiscovery';

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
});
