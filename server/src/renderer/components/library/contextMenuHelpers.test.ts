import { describe, expect, it } from 'vitest';
import {
  findNameById,
  formatItemCount,
  getContextMenuActiveIds,
  parseTagText,
} from './contextMenuHelpers';

describe('contextMenuHelpers', () => {
  describe('getContextMenuActiveIds', () => {
    it('uses the whole selection when the target comic is selected', () => {
      expect(getContextMenuActiveIds(2, [1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('uses only the target comic when right-clicking outside the selection', () => {
      expect(getContextMenuActiveIds(5, [1, 2, 3])).toEqual([5]);
    });

    it('returns no active ids when there is no target comic', () => {
      expect(getContextMenuActiveIds(null, [1, 2, 3])).toEqual([]);
    });
  });

  it('parses comma-separated tags and drops empty entries', () => {
    expect(parseTagText(' action, , omnibus, favorite ')).toEqual([
      'action',
      'omnibus',
      'favorite',
    ]);
  });

  it('formats singular and plural item counts', () => {
    expect(formatItemCount(1)).toBe('1 item');
    expect(formatItemCount(2)).toBe('2 items');
  });

  it('finds names by id with a fallback', () => {
    expect(findNameById([{ id: 10, name: 'Shelf' }], 10, 'Collection')).toBe('Shelf');
    expect(findNameById([{ id: 10, name: 'Shelf' }], 11, 'Collection')).toBe('Collection');
  });
});
