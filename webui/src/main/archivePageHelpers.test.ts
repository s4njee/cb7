import { describe, expect, it } from 'vitest';
import {
  assertArchivePageInRange,
  createArchivePageCache,
  getCachedArchivePage,
} from './archivePageHelpers';

describe('archivePageHelpers', () => {
  it('accepts page indexes inside the archive range', () => {
    expect(() => assertArchivePageInRange(0, 2)).not.toThrow();
    expect(() => assertArchivePageInRange(1, 2)).not.toThrow();
  });

  it('throws a consistent error for page indexes outside the archive range', () => {
    expect(() => assertArchivePageInRange(-1, 2)).toThrow(
      'Page index -1 out of range (0-1)',
    );
    expect(() => assertArchivePageInRange(2, 2)).toThrow(
      'Page index 2 out of range (0-1)',
    );
  });

  it('loads and caches archive pages by page index', async () => {
    const cache = createArchivePageCache(1024);
    const page = Buffer.from('page-data');
    let loads = 0;

    const first = await getCachedArchivePage(cache, 0, 1, async () => {
      loads++;
      return page;
    });
    const second = await getCachedArchivePage(cache, 0, 1, async () => {
      loads++;
      return Buffer.from('unexpected');
    });

    expect(first).toBe(page);
    expect(second).toBe(page);
    expect(loads).toBe(1);
  });

  it('wraps backend load errors with page context', async () => {
    const cache = createArchivePageCache(1024);

    await expect(
      getCachedArchivePage(cache, 0, 1, async () => {
        throw new Error('backend failed');
      }),
    ).rejects.toThrow('Failed to read page 0: backend failed');
  });
});
