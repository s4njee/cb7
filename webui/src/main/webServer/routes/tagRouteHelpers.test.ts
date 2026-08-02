import { describe, expect, it } from 'vitest';
import { diffTags, normalizeTagList, parseTagNameFromPath } from './tagRouteHelpers';

describe('tagRouteHelpers', () => {
  it('normalizes tag arrays by trimming, dropping blanks, and de-duping', () => {
    expect(normalizeTagList([' sci-fi ', '', 'manga', 'sci-fi', 42])).toEqual({
      ok: true,
      tags: ['sci-fi', 'manga'],
    });
  });

  it('rejects non-array tag payloads', () => {
    expect(normalizeTagList('sci-fi')).toEqual({
      ok: false,
      error: 'Provide "tags" (array)',
    });
  });

  it('diffs current and next tag lists in stable input order', () => {
    expect(diffTags(['old', 'keep'], ['keep', 'new'])).toEqual({
      added: ['new'],
      removed: ['old'],
      next: ['keep', 'new'],
    });
  });

  it('decodes and trims tag path names', () => {
    expect(parseTagNameFromPath('space%20opera%20')).toBe('space opera');
  });
});
