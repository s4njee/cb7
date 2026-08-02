import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatStatusBar } from './statusFormat';

describe('formatStatusBar', () => {
  it('formats first page correctly', () => {
    expect(formatStatusBar(0, 10)).toBe('1 / 10');
  });

  it('formats last page correctly', () => {
    expect(formatStatusBar(9, 10)).toBe('10 / 10');
  });

  it('formats middle page correctly', () => {
    expect(formatStatusBar(4, 10)).toBe('5 / 10');
  });

  it('handles single page', () => {
    expect(formatStatusBar(0, 1)).toBe('1 / 1');
  });

  it('handles large page numbers', () => {
    expect(formatStatusBar(99, 100)).toBe('100 / 100');
    expect(formatStatusBar(999, 1000)).toBe('1000 / 1000');
  });
});

describe('formatStatusBar - property tests', () => {
  it('Property 6: Format is always "X / Y"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 1, max: 1000 }),
        (currentPage, totalPages) => {
          if (currentPage >= totalPages) return;
          
          const result = formatStatusBar(currentPage, totalPages);
          const match = result.match(/^(\d+) \/ (\d+)$/);
          
          expect(match).not.toBeNull();
          expect(match![1]).toBe(String(currentPage + 1));
          expect(match![2]).toBe(String(totalPages));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 6: Current page is always one-based', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 1, max: 1000 }),
        (currentPage, totalPages) => {
          if (currentPage >= totalPages) return;
          
          const result = formatStatusBar(currentPage, totalPages);
          const displayPage = parseInt(result.split(' / ')[0]);
          
          expect(displayPage).toBe(currentPage + 1);
          expect(displayPage).toBeGreaterThan(0);
          expect(displayPage).toBeLessThanOrEqual(totalPages);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 6: Total pages matches input', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 1, max: 1000 }),
        (currentPage, totalPages) => {
          if (currentPage >= totalPages) return;
          
          const result = formatStatusBar(currentPage, totalPages);
          const displayTotal = parseInt(result.split(' / ')[1]);
          
          expect(displayTotal).toBe(totalPages);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 6: First page is always "1 / N"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        (totalPages) => {
          const result = formatStatusBar(0, totalPages);
          expect(result).toBe(`1 / ${totalPages}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 6: Last page is always "N / N"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        (totalPages) => {
          const result = formatStatusBar(totalPages - 1, totalPages);
          expect(result).toBe(`${totalPages} / ${totalPages}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});
