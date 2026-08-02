import { describe, expect, it } from 'vitest';
import {
  buildProgressUpdate,
  hasProgressUpdate,
  progressMirrorUpdate,
} from './progressRouteHelpers';

describe('progressRouteHelpers', () => {
  it('builds a progress update from validated fields', () => {
    expect(buildProgressUpdate({ page: 99, location: 'cfi', completed: false }, 4, 10)).toEqual({
      page: 4,
      location: 'cfi',
      completed: false,
    });
  });

  it('auto-completes when page reaches the final page', () => {
    expect(buildProgressUpdate({ page: 99 }, 9, 10)).toEqual({
      page: 9,
      completed: true,
    });
  });

  it('does not override an explicit completed value', () => {
    expect(buildProgressUpdate({ page: 99, completed: false }, 9, 10)).toEqual({
      page: 9,
      completed: false,
    });
  });

  it('captures and clamps a whole-book percent for reflowable formats', () => {
    expect(buildProgressUpdate({ location: 'cfi', percent: 42.6 }, undefined, 65)).toEqual({
      location: 'cfi',
      percent: 43,
    });
    expect(buildProgressUpdate({ percent: -5 }, undefined, 65)).toEqual({ percent: 0 });
    expect(buildProgressUpdate({ percent: 150 }, undefined, 65)).toEqual({ percent: 100 });
  });

  it('ignores a non-finite or non-numeric percent', () => {
    expect(buildProgressUpdate({ percent: 'lots' }, undefined, 65)).toEqual({});
    expect(buildProgressUpdate({ percent: Number.NaN }, undefined, 65)).toEqual({});
  });

  it('detects empty updates', () => {
    expect(hasProgressUpdate({})).toBe(false);
    expect(hasProgressUpdate({ completed: false })).toBe(true);
    expect(hasProgressUpdate({ location: '' })).toBe(true);
    expect(hasProgressUpdate({ percent: 0 })).toBe(true);
  });

  it('chooses the legacy progress mirror update', () => {
    expect(progressMirrorUpdate({ page: 3, location: 'cfi' })).toEqual({ kind: 'page', page: 3 });
    expect(progressMirrorUpdate({ location: 'cfi' })).toEqual({ kind: 'location', location: 'cfi' });
    expect(progressMirrorUpdate({ completed: true })).toEqual({ kind: 'none' });
  });
});
