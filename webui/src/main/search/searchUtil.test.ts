import { describe, it, expect } from 'vitest';
import { chunkText, rrfFuse } from './searchUtil';

describe('chunkText', () => {
  it('splits on paragraph boundaries and respects the size budget', () => {
    const text = ['a'.repeat(500), 'b'.repeat(500), 'c'.repeat(500)].join('\n\n');
    const chunks = chunkText(text, 900, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // no chunk wildly exceeds the budget (allow the overlap carry-over)
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThan(1300);
  });

  it('returns a single chunk for short text and drops empties', () => {
    expect(chunkText('one short paragraph')).toEqual(['one short paragraph']);
    expect(chunkText('\n\n   \n\n')).toEqual([]);
  });
});

describe('rrfFuse', () => {
  it('ranks an item found by both arms above items found by only one', () => {
    const kw = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const sem = [{ id: 3 }, { id: 4 }, { id: 5 }];
    const fused = rrfFuse([kw, sem], 60, 5);
    expect(fused[0].id).toBe(3); // appears in both arms → highest
    expect(new Set(fused.map((r) => r.id)).size).toBe(fused.length); // deduped
  });

  it('honours the limit', () => {
    const arm = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    expect(rrfFuse([arm], 60, 8)).toHaveLength(8);
  });
});
