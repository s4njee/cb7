import { describe, expect, it } from 'vitest';
import { classifyIngestError } from './ingestErrorLog';

// Persistence is covered by src/main/db/ingestErrors.test.ts (pg-gated); this
// module is now just the pure classifier.
describe('classifyIngestError', () => {
  it('classifies deterministic ingest failures', () => {
    const missing = new Error('missing');
    (missing as NodeJS.ErrnoException).code = 'ENOENT';
    const denied = new Error('denied');
    (denied as NodeJS.ErrnoException).code = 'EACCES';

    expect(classifyIngestError(new Error('RangeError: WebAssembly out of bounds memory access'), 'a.cbr'))
      .toBe('wasm_oom');
    expect(classifyIngestError(missing, 'a.cbz')).toBe('fs_missing');
    expect(classifyIngestError(denied, 'a.cbz')).toBe('fs_permission');
    expect(classifyIngestError(new Error('cover extraction timed out after 30000 ms'), 'a.cbz'))
      .toBe('timeout');
    expect(classifyIngestError(new Error('Can not open encrypted archive'), 'a.cbr'))
      .toBe('archive_extract');
    expect(classifyIngestError(new Error('Failed to open archive: Bad CRC'), 'a.cbr'))
      .toBe('archive_open');
    expect(classifyIngestError(new Error('something unexpected'), 'a.cbz')).toBe('unknown');
  });
});
