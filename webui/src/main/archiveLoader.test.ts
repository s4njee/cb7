import { execFileSync } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ArchiveLoader from './archiveLoader';
import { assertSevenZipAvailable } from './sevenZipPath';

describe('ArchiveLoader folder comics', () => {
  it('opens a plain directory as a virtual archive', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cb8-folder-comic-'));
    try {
      await fsp.writeFile(path.join(dir, 'page10.jpg'), Buffer.from('page10'));
      await fsp.writeFile(path.join(dir, 'notes.txt'), Buffer.from('ignore me'));
      await fsp.writeFile(path.join(dir, 'page2.jpg'), Buffer.from('page2'));
      await fsp.writeFile(path.join(dir, 'page1.png'), Buffer.from('page1'));

      const handle = await ArchiveLoader.open(dir);

      expect(handle.format).toBe('folder');
      expect(handle.entries).toEqual([
        { filename: 'page1.png', index: 0 },
        { filename: 'page2.jpg', index: 1 },
        { filename: 'page10.jpg', index: 2 },
      ]);
      expect(handle.pageCount).toBe(3);

      const page1 = await ArchiveLoader.getPage(handle, 0);
      expect(page1).toEqual(Buffer.from('page1'));
      const page10 = await ArchiveLoader.getPage(handle, 2);
      expect(page10).toEqual(Buffer.from('page10'));

      await expect(ArchiveLoader.getPage(handle, 3)).rejects.toThrow();
      await expect(ArchiveLoader.getPage(handle, -1)).rejects.toThrow();

      // Folders have no named entries; readArchiveEntry resolves to null.
      await expect(ArchiveLoader.readArchiveEntry(handle, 'notes.txt')).resolves.toBeNull();

      await expect(ArchiveLoader.close(handle)).resolves.toBeUndefined();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('ArchiveLoader cb7 (7z)', () => {
  it('opens a .cb7 archive built by 7-Zip', async () => {
    let bin: string;
    try {
      bin = assertSevenZipAvailable();
    } catch {
      return; // 7-Zip not installed on this machine — skip.
    }

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cb8-cb7-'));
    const archivePath = path.join(dir, 'book.cb7');
    const page1Bytes = Buffer.from('page1-bytes');
    const page2Bytes = Buffer.from('page2-bytes');
    try {
      // Build with relative names so the archive stores bare filenames.
      await fsp.writeFile(path.join(dir, 'page2.jpg'), page2Bytes);
      await fsp.writeFile(path.join(dir, 'page1.jpg'), page1Bytes);
      execFileSync(bin, ['a', archivePath, 'page1.jpg', 'page2.jpg'], { cwd: dir, stdio: 'ignore' });

      const handle = await ArchiveLoader.open(archivePath);

      expect(handle.format).toBe('cb7');
      expect(handle.entries).toEqual([
        { filename: 'page1.jpg', index: 0 },
        { filename: 'page2.jpg', index: 1 },
      ]);
      expect(handle.pageCount).toBe(2);

      const gotPage1 = await ArchiveLoader.getPage(handle, 0);
      expect(gotPage1).toEqual(page1Bytes);
      const gotPage2 = await ArchiveLoader.getPage(handle, 1);
      expect(gotPage2).toEqual(page2Bytes);

      await expect(ArchiveLoader.close(handle)).resolves.toBeUndefined();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
