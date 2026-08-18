import { describe, expect, it } from 'vitest';
import {
  failureReportDetails,
  ingestFailureLabel,
  ingestPhaseLabel,
  ingestProgressPercent,
  pathBasename,
} from './addPathPanelHelpers';

describe('addPathPanelHelpers', () => {
  it('formats ingest phase labels', () => {
    expect(ingestPhaseLabel('discover')).toBe('Discovering files...');
    expect(ingestPhaseLabel('process')).toBe('Processing files...');
  });

  it('calculates bounded progress percentages', () => {
    expect(ingestProgressPercent(0, 0)).toBe(0);
    expect(ingestProgressPercent(5, 10)).toBe(50);
    expect(ingestProgressPercent(11, 10)).toBe(100);
  });

  it('maps ingest failure classes to user-facing labels', () => {
    expect(ingestFailureLabel('archive_open')).toBe('Archive open failed (corrupt / encrypted / unsupported)');
    expect(ingestFailureLabel('fs_permission')).toBe('Permission denied');
    expect(ingestFailureLabel('custom_class')).toBe('custom_class');
  });

  it('gets basenames from slash and backslash paths', () => {
    expect(pathBasename('/library/Saga/book.cbz')).toBe('book.cbz');
    expect(pathBasename('C:\\library\\Saga\\book.cbz')).toBe('book.cbz');
    expect(pathBasename('book.cbz')).toBe('book.cbz');
  });

  it('sorts failure classes and limits samples', () => {
    const details = failureReportDetails({
      type: 'failures-summary',
      total: 10,
      byClass: { timeout: 2, archive_open: 5, fs_permission: 3 },
      sample: Array.from({ length: 9 }, (_, index) => ({
        path: `/library/file-${index}.cbz`,
        errorClass: 'timeout',
        message: 'nope',
      })),
    });

    expect(details.byClass).toEqual([
      ['archive_open', 5],
      ['fs_permission', 3],
      ['timeout', 2],
    ]);
    expect(details.samples).toHaveLength(8);
    expect(details.samples[0].path).toBe('/library/file-0.cbz');
  });
});
