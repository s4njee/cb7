import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { naturalCompare } from './naturalSort';

describe('naturalCompare', () => {
  it('sorts page2.jpg before page10.jpg', () => {
    expect(naturalCompare('page2.jpg', 'page10.jpg')).toBeLessThan(0);
  });

  it('sorts page1.jpg before page2.jpg', () => {
    expect(naturalCompare('page1.jpg', 'page2.jpg')).toBeLessThan(0);
  });

  it('returns 0 for identical strings', () => {
    expect(naturalCompare('page1.jpg', 'page1.jpg')).toBe(0);
  });

  it('handles purely numeric strings', () => {
    expect(naturalCompare('2', '10')).toBeLessThan(0);
    expect(naturalCompare('10', '2')).toBeGreaterThan(0);
  });

  it('handles purely alphabetic strings lexicographically', () => {
    expect(naturalCompare('abc', 'def')).toBeLessThan(0);
    expect(naturalCompare('def', 'abc')).toBeGreaterThan(0);
  });

  it('is case-insensitive for non-numeric chunks', () => {
    expect(naturalCompare('Page1.jpg', 'page1.jpg')).toBe(0);
    expect(naturalCompare('ABC', 'abc')).toBe(0);
  });

  it('sorts a realistic list of comic page filenames', () => {
    const files = ['page10.jpg', 'page2.jpg', 'page1.jpg', 'page20.jpg', 'page3.jpg'];
    const sorted = [...files].sort(naturalCompare);
    expect(sorted).toEqual(['page1.jpg', 'page2.jpg', 'page3.jpg', 'page10.jpg', 'page20.jpg']);
  });

  it('handles filenames with multiple numeric segments', () => {
    const files = ['ch2-page10.jpg', 'ch2-page2.jpg', 'ch1-page5.jpg', 'ch10-page1.jpg'];
    const sorted = [...files].sort(naturalCompare);
    expect(sorted).toEqual(['ch1-page5.jpg', 'ch2-page2.jpg', 'ch2-page10.jpg', 'ch10-page1.jpg']);
  });

  it('handles empty strings', () => {
    expect(naturalCompare('', '')).toBe(0);
    expect(naturalCompare('', 'a')).toBeLessThan(0);
    expect(naturalCompare('a', '')).toBeGreaterThan(0);
  });

  it('handles strings with no numeric parts', () => {
    const files = ['cover.jpg', 'back.jpg', 'front.jpg'];
    const sorted = [...files].sort(naturalCompare);
    expect(sorted).toEqual(['back.jpg', 'cover.jpg', 'front.jpg']);
  });

  it('handles nested directory paths', () => {
    const files = ['dir/page10.jpg', 'dir/page2.jpg', 'dir/page1.jpg'];
    const sorted = [...files].sort(naturalCompare);
    expect(sorted).toEqual(['dir/page1.jpg', 'dir/page2.jpg', 'dir/page10.jpg']);
  });
});

describe('naturalCompare - property tests', () => {
  it('Property 1: Natural sort ordering - numeric substrings compared by value', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 50 }),
        (filenames) => {
          const sorted = [...filenames].sort(naturalCompare);
          
          // Verify sorted array is stable
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(naturalCompare(sorted[i], sorted[i + 1])).toBeLessThanOrEqual(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 1: Numeric chunks sort by numeric value', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 10 }),
        fc.integer({ min: 1, max: 999 }),
        fc.integer({ min: 1, max: 999 }),
        fc.string({ minLength: 0, maxLength: 10 }),
        (prefix, num1, num2, suffix) => {
          const s1 = `${prefix}${num1}${suffix}`;
          const s2 = `${prefix}${num2}${suffix}`;
          const cmp = naturalCompare(s1, s2);
          
          if (num1 < num2) {
            expect(cmp).toBeLessThan(0);
          } else if (num1 > num2) {
            expect(cmp).toBeGreaterThan(0);
          } else {
            expect(cmp).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 1: Comparator is reflexive (a == a)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        (s) => {
          expect(naturalCompare(s, s)).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 1: Comparator is antisymmetric (if a < b then b > a)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.string({ minLength: 0, maxLength: 50 }),
        (a, b) => {
          const cmpAB = naturalCompare(a, b);
          const cmpBA = naturalCompare(b, a);
          
          if (cmpAB < 0) {
            expect(cmpBA).toBeGreaterThan(0);
          } else if (cmpAB > 0) {
            expect(cmpBA).toBeLessThan(0);
          } else {
            expect(cmpBA).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 1: Comparator is transitive (if a < b and b < c then a < c)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 30 }),
        fc.string({ minLength: 0, maxLength: 30 }),
        fc.string({ minLength: 0, maxLength: 30 }),
        (a, b, c) => {
          const cmpAB = naturalCompare(a, b);
          const cmpBC = naturalCompare(b, c);
          const cmpAC = naturalCompare(a, c);
          
          if (cmpAB < 0 && cmpBC < 0) {
            expect(cmpAC).toBeLessThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
