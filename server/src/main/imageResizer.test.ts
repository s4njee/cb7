import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearImageCaches, getCacheStats, setImageCacheRoot, setUpscaleCacheRoot } from './imageResizer';

/**
 * P2-2 cache controls. The cache layout is `root/<comicId>/<file>.webp`, so a
 * seeded root needs one level of subdirectories under it.
 */
describe('imageResizer cache controls (P2-2)', () => {
  let imageDir: string;
  let upscaleDir: string;

  afterEach(async () => {
    if (imageDir) await rm(imageDir, { recursive: true, force: true });
    if (upscaleDir) await rm(upscaleDir, { recursive: true, force: true });
  });

  async function seed(root: string, files: Array<[string, number]>): Promise<void> {
    for (const [rel, size] of files) {
      const full = join(root, rel);
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, Buffer.alloc(size));
    }
  }

  it('reports footprint for both caches and clears them', async () => {
    imageDir = await mkdtemp(join(tmpdir(), 'cb8-img-'));
    upscaleDir = await mkdtemp(join(tmpdir(), 'cb8-ups-'));
    setImageCacheRoot(imageDir);
    setUpscaleCacheRoot(upscaleDir);

    await seed(imageDir, [['1/thumb.webp', 100], ['1/wide.webp', 250]]);
    await seed(upscaleDir, [['3/hash.webp', 500]]);

    const stats = await getCacheStats();
    expect(stats.imageCache.sizeBytes).toBe(350);
    expect(stats.imageCache.fileCount).toBe(2);
    expect(stats.upscaleCache.sizeBytes).toBe(500);
    expect(stats.upscaleCache.fileCount).toBe(1);

    await clearImageCaches();
    const after = await getCacheStats();
    expect(after.imageCache.sizeBytes).toBe(0);
    expect(after.upscaleCache.sizeBytes).toBe(0);
  });

  it('reports zero when a cache directory is missing', async () => {
    imageDir = join(tmpdir(), `cb8-img-missing-${Date.now()}`);
    upscaleDir = join(tmpdir(), `cb8-ups-missing-${Date.now()}`);
    setImageCacheRoot(imageDir);
    setUpscaleCacheRoot(upscaleDir);

    const stats = await getCacheStats();
    expect(stats.imageCache.sizeBytes).toBe(0);
    expect(stats.imageCache.fileCount).toBe(0);
    expect(stats.upscaleCache.sizeBytes).toBe(0);
  });
});
