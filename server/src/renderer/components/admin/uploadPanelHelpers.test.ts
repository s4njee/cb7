import { describe, expect, it } from 'vitest';
import {
  appendAcceptedUploadItems,
  hasUploadableItems,
  overallUploadProgressPercent,
  totalUploadBytes,
  uploadPrimaryLabel,
  uploadProgressPercent,
  uploadQueueSummary,
  uploadRowStatus,
  type UploadQueueItem,
} from './uploadPanelHelpers';

function file(name: string, size: number): File {
  return new File(['x'.repeat(size)], name);
}

const pendingItem: UploadQueueItem = {
  file: file('one.cbz', 100),
  relPath: 'one.cbz',
  status: 'pending',
  loaded: 0,
};

describe('uploadPanelHelpers', () => {
  it('appends supported new files while skipping duplicates and unsupported files', () => {
    const next = appendAcceptedUploadItems([pendingItem], [
      { file: file('one.cbz', 100), relPath: 'one.cbz' },
      { file: file('two.epub', 200), relPath: 'two.epub' },
      { file: file('notes.txt', 10), relPath: 'notes.txt' },
    ]);

    expect(next.map((item) => item.relPath)).toEqual(['one.cbz', 'two.epub']);
    expect(next[1]).toMatchObject({ status: 'pending', loaded: 0 });
  });

  it('sums and labels queued bytes', () => {
    const queue = [
      { ...pendingItem, file: file('one.cbz', 1024) },
      { ...pendingItem, relPath: 'two.cbz', file: file('two.cbz', 2048) },
    ];

    expect(totalUploadBytes(queue)).toBe(3072);
    expect(uploadQueueSummary(queue)).toEqual({
      countLabel: '2 files queued',
      bytesLabel: '3.0 KB',
    });
  });

  it('decides whether the primary action should upload or finish', () => {
    expect(hasUploadableItems([{ status: 'done' }, { status: 'skipped' }])).toBe(false);
    expect(uploadPrimaryLabel([{ status: 'done' }, { status: 'skipped' }])).toBe('Done');
    expect(uploadPrimaryLabel([{ status: 'done' }, { status: 'error' }])).toBe('Upload');
  });

  it('formats row status text, class, and percent', () => {
    expect(uploadProgressPercent({ file: file('page.cbz', 200), loaded: 50 })).toBe(25);
    expect(uploadProgressPercent({ file: file('empty.cbz', 0), loaded: 10 })).toBe(0);

    expect(uploadRowStatus({ ...pendingItem, status: 'uploading', loaded: 25 })).toEqual({
      text: '25%',
      className: 'text-primary font-bold',
      percent: 25,
    });
    expect(uploadRowStatus({
      ...pendingItem,
      status: 'uploading',
      loaded: 100,
    }).text).toBe('Processing…');
    expect(uploadRowStatus({ ...pendingItem, status: 'done' }).text).toBe('Added');
    expect(uploadRowStatus({ ...pendingItem, status: 'skipped' }).text).toBe('Already in library');
    expect(uploadRowStatus({ ...pendingItem, status: 'error', error: 'Nope' }).text).toBe('Nope');
    expect(uploadRowStatus(pendingItem).text).toBe('');
  });

  it('computes overall progress from completed + in-flight bytes', () => {
    // Single 50MB file at 25% transferred → overall 25%, not stuck at 0.
    expect(overallUploadProgressPercent(0, 12_500_000, 50_000_000)).toBe(25);
    // First of two equal files done, second at halfway → 75%.
    expect(overallUploadProgressPercent(10_000_000, 5_000_000, 20_000_000)).toBe(75);
    expect(overallUploadProgressPercent(0, 0, 0)).toBe(0);
    expect(overallUploadProgressPercent(20_000_000, 0, 20_000_000)).toBe(100);
  });
});
