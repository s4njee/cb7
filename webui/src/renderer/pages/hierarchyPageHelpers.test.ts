import { describe, expect, it } from 'vitest';
import {
  browseChapterHref,
  firstPageTotalCount,
  folderChapterHref,
  hasUnnumberedVolume,
  isSingleUnnumberedVolume,
  namedVolumeGroups,
  recordsFromPages,
  shouldShowChapterGroups,
} from './hierarchyPageHelpers';
import { GROUP_NONE_KEY } from '../lib/utils';

describe('hierarchyPageHelpers', () => {
  it('detects the special single-unnumbered volume case', () => {
    expect(isSingleUnnumberedVolume([{ key: GROUP_NONE_KEY }])).toBe(true);
    expect(isSingleUnnumberedVolume([{ key: '1' }])).toBe(false);
    expect(isSingleUnnumberedVolume([{ key: GROUP_NONE_KEY }, { key: '1' }])).toBe(false);
  });

  it('splits named and unnumbered volume groups', () => {
    const groups = [
      { key: GROUP_NONE_KEY, count: 2 },
      { key: '1', count: 5 },
    ];

    expect(hasUnnumberedVolume(groups)).toBe(true);
    expect(namedVolumeGroups(groups)).toEqual([{ key: '1', count: 5 }]);
  });

  it('decides when chapter grouping is useful', () => {
    expect(shouldShowChapterGroups([{ key: GROUP_NONE_KEY, count: 5 }])).toBe(false);
    expect(shouldShowChapterGroups([{ key: '3', count: 1 }])).toBe(false);
    expect(shouldShowChapterGroups([{ key: '3', count: 2 }])).toBe(true);
    expect(shouldShowChapterGroups([{ key: '1', count: 1 }, { key: '2', count: 1 }])).toBe(true);
  });

  it('flattens paged record responses and reads first page totals', () => {
    const data = {
      pages: [
        { records: ['a', 'b'], totalCount: 3 },
        { records: ['c'], totalCount: 3 },
      ],
    };

    expect(recordsFromPages(data)).toEqual(['a', 'b', 'c']);
    expect(firstPageTotalCount(data)).toBe(3);
    expect(recordsFromPages(undefined)).toEqual([]);
    expect(firstPageTotalCount(undefined)).toBe(0);
  });

  it('builds browse and folder chapter links', () => {
    expect(browseChapterHref('A/B', 'Vol 1', { key: 'Ch 2', count: 3 })).toBe(
      '/browse/series/A%2FB/volume/Vol%201/chapter/Ch%202'
    );
    expect(folderChapterHref(9, 'A/B', 'Vol 1', { key: 'Ch 2', count: 3 })).toBe(
      '/folder/9/series/A%2FB/volume/Vol%201/chapter/Ch%202'
    );
    expect(browseChapterHref('A', '1', { key: '1', count: 1, singleComicId: 42 })).toBe('/read/42');
    expect(folderChapterHref(9, 'A', '1', { key: '1', count: 1, singleComicId: 42 })).toBe('/read/42');
  });
});
