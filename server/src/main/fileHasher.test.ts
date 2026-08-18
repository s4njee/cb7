import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256File } from './fileHasher';

describe('sha256File', () => {
  it('hashes a file to its SHA-256 hex digest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb8-hash-'));
    try {
      const file = join(dir, 'sample.cbz');
      const content = Buffer.from('page-1 page-2 page-3');
      await writeFile(file, content);
      expect(await sha256File(file)).toBe(crypto.createHash('sha256').update(content).digest('hex'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects for a missing file', async () => {
    await expect(sha256File('/no/such/file.cbz')).rejects.toThrow();
  });
});
