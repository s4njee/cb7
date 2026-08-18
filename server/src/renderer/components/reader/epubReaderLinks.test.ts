import { describe, expect, it } from 'vitest';
import { normalizeInternalHref, resolveEpubDisplayTarget } from './epubReaderLinks';
import type { EpubBook } from './EpubReaderTypes';

function bookWithSpine(map: Record<string, number>): EpubBook {
  return {
    loaded: { navigation: Promise.resolve({ toc: [] }) },
    spine: {
      get: (target?: string | number) => {
        if (typeof target !== 'string' || !(target in map)) return null;
        return { href: target, index: map[target] };
      },
    },
    renderTo: () => {
      throw new Error('renderTo is not needed for link helper tests');
    },
  };
}

describe('epubReaderLinks', () => {
  it('normalizes relative internal links against the current section', () => {
    expect(normalizeInternalHref('../notes/end.xhtml#fn1', 'chapters/ch01/page.xhtml'))
      .toBe('chapters/notes/end.xhtml#fn1');
    expect(normalizeInternalHref('#local', 'chapters/ch01/page.xhtml'))
      .toBe('chapters/ch01/page.xhtml#local');
    expect(normalizeInternalHref('/absolute/path.xhtml'))
      .toBe('absolute/path.xhtml');
  });

  it('rejects external or unsafe schemes', () => {
    expect(normalizeInternalHref('https://example.com')).toBeNull();
    expect(normalizeInternalHref('mailto:test@example.com')).toBeNull();
    expect(normalizeInternalHref('javascript:alert(1)')).toBeNull();
  });

  it('resolves normalized links through the EPUB spine before falling back to href', () => {
    const book = bookWithSpine({
      'chapters/notes/end.xhtml#fn1': 8,
      'absolute/path.xhtml': 12,
    });

    expect(resolveEpubDisplayTarget(book, '../notes/end.xhtml#fn1', 'chapters/ch01/page.xhtml')).toBe(8);
    expect(resolveEpubDisplayTarget(book, '/absolute/path.xhtml')).toBe(12);
    expect(resolveEpubDisplayTarget(book, 'missing.xhtml')).toBe('missing.xhtml');
    expect(resolveEpubDisplayTarget(book, 'epubcfi(/6/2[chapter]!/4/1:0)')).toBe('epubcfi(/6/2[chapter]!/4/1:0)');
  });
});
