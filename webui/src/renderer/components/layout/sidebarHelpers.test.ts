import { describe, expect, it } from 'vitest';
import { formatFolderRescanMessage, isSidebarPathActive } from './sidebarHelpers';

describe('sidebarHelpers', () => {
  it('treats the root sidebar link as active for root paths only', () => {
    expect(isSidebarPathActive('/', '/')).toBe(true);
    expect(isSidebarPathActive('', '/')).toBe(true);
    expect(isSidebarPathActive('/recent', '/')).toBe(false);
  });

  it('matches non-root sidebar links exactly', () => {
    expect(isSidebarPathActive('/recent', '/recent')).toBe(true);
    expect(isSidebarPathActive('/recent/extra', '/recent')).toBe(false);
  });

  it('formats folder rescan results', () => {
    expect(formatFolderRescanMessage(0, 'Manga')).toBe('No new items found in "Manga"');
    expect(formatFolderRescanMessage(1, 'Manga')).toBe('Added 1 item to "Manga"');
    expect(formatFolderRescanMessage(3, 'Manga')).toBe('Added 3 items to "Manga"');
  });
});
