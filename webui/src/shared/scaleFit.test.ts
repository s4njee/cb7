import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { scaleToFit } from './scaleFit';

describe('scaleToFit', () => {
  it('scales wide image to fit viewport width', () => {
    const result = scaleToFit(1000, 500, 800, 600);
    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
  });

  it('scales tall image to fit viewport height', () => {
    const result = scaleToFit(500, 1000, 800, 600);
    expect(result.width).toBe(300);
    expect(result.height).toBe(600);
  });

  it('handles square image in square viewport', () => {
    const result = scaleToFit(1000, 1000, 500, 500);
    expect(result.width).toBe(500);
    expect(result.height).toBe(500);
  });

  it('handles image smaller than viewport', () => {
    const result = scaleToFit(100, 100, 1000, 1000);
    expect(result.width).toBe(1000);
    expect(result.height).toBe(1000);
  });

  it('returns zero dimensions for invalid inputs', () => {
    expect(scaleToFit(0, 100, 800, 600)).toEqual({ width: 0, height: 0 });
    expect(scaleToFit(100, 0, 800, 600)).toEqual({ width: 0, height: 0 });
    expect(scaleToFit(100, 100, 0, 600)).toEqual({ width: 0, height: 0 });
    expect(scaleToFit(100, 100, 800, 0)).toEqual({ width: 0, height: 0 });
  });

  it('handles very wide image', () => {
    const result = scaleToFit(2000, 100, 800, 600);
    expect(result.width).toBe(800);
    expect(result.height).toBeLessThanOrEqual(600);
  });

  it('handles very tall image', () => {
    const result = scaleToFit(100, 2000, 800, 600);
    expect(result.width).toBeLessThanOrEqual(800);
    expect(result.height).toBe(600);
  });
});

describe('scaleToFit - property tests', () => {
  const tolerance = 0.01; // 1% tolerance for floating point comparisons

  it('Property 3: Preserves aspect ratio', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (imgW, imgH, vpW, vpH) => {
          const result = scaleToFit(imgW, imgH, vpW, vpH);
          
          if (result.width === 0 || result.height === 0) return;
          
          const originalAspect = imgW / imgH;
          const scaledAspect = result.width / result.height;
          const aspectDiff = Math.abs(originalAspect - scaledAspect) / originalAspect;
          
          expect(aspectDiff).toBeLessThan(tolerance);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: Fits within viewport', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (imgW, imgH, vpW, vpH) => {
          const result = scaleToFit(imgW, imgH, vpW, vpH);
          
          expect(result.width).toBeLessThanOrEqual(vpW + tolerance);
          expect(result.height).toBeLessThanOrEqual(vpH + tolerance);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: At least one dimension matches viewport', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (imgW, imgH, vpW, vpH) => {
          const result = scaleToFit(imgW, imgH, vpW, vpH);
          
          const widthMatch = Math.abs(result.width - vpW) < tolerance;
          const heightMatch = Math.abs(result.height - vpH) < tolerance;
          
          expect(widthMatch || heightMatch).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: Returns zero for non-positive dimensions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 0 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (invalidDim, dim2, dim3, dim4) => {
          // Test with invalid image width
          expect(scaleToFit(invalidDim, dim2, dim3, dim4)).toEqual({ width: 0, height: 0 });
          // Test with invalid image height
          expect(scaleToFit(dim2, invalidDim, dim3, dim4)).toEqual({ width: 0, height: 0 });
          // Test with invalid viewport width
          expect(scaleToFit(dim2, dim3, invalidDim, dim4)).toEqual({ width: 0, height: 0 });
          // Test with invalid viewport height
          expect(scaleToFit(dim2, dim3, dim4, invalidDim)).toEqual({ width: 0, height: 0 });
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: Scaling is consistent', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (imgW, imgH, vpW, vpH) => {
          const result1 = scaleToFit(imgW, imgH, vpW, vpH);
          const result2 = scaleToFit(imgW, imgH, vpW, vpH);
          
          expect(result1.width).toBe(result2.width);
          expect(result1.height).toBe(result2.height);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: Proportional scaling', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 2, max: 10 }),
        (imgW, imgH, vpW, vpH, scale) => {
          const result1 = scaleToFit(imgW, imgH, vpW, vpH);
          const result2 = scaleToFit(imgW * scale, imgH * scale, vpW, vpH);
          
          // Scaling the image proportionally should produce the same result
          const widthDiff = Math.abs(result1.width - result2.width);
          const heightDiff = Math.abs(result1.height - result2.height);
          
          expect(widthDiff).toBeLessThan(tolerance);
          expect(heightDiff).toBeLessThan(tolerance);
        }
      ),
      { numRuns: 100 }
    );
  });
});
