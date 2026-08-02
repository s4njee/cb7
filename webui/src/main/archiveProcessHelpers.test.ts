import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  readPositiveIntEnv,
  runSevenZip,
  spawnToBuffer,
  type SevenZipStream,
} from './archiveProcessHelpers';

class FakeSevenZipStream<T> extends EventEmitter {
  _childProcess = { kill: vi.fn() };

  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

describe('archiveProcessHelpers', () => {
  it('reads positive integer environment overrides', () => {
    expect(readPositiveIntEnv('TIMEOUT', 100, { TIMEOUT: '250' })).toBe(250);
    expect(readPositiveIntEnv('TIMEOUT', 100, { TIMEOUT: '0' })).toBe(100);
    expect(readPositiveIntEnv('TIMEOUT', 100, { TIMEOUT: '-5' })).toBe(100);
    expect(readPositiveIntEnv('TIMEOUT', 100, { TIMEOUT: 'nope' })).toBe(100);
    expect(readPositiveIntEnv('TIMEOUT', 100, {})).toBe(100);
  });

  it('collects stdout from a spawned command', async () => {
    const buffer = await spawnToBuffer(process.execPath, [
      '-e',
      'process.stdout.write("archive-output")',
    ]);

    expect(buffer.toString()).toBe('archive-output');
  });

  it('uses stderr for spawned command failures when available', async () => {
    await expect(spawnToBuffer(process.execPath, [
      '-e',
      'process.stderr.write("archive failed"); process.exit(2)',
    ])).rejects.toThrow('archive failed');
  });

  it('resolves 7-Zip stream records in order', async () => {
    const stream = new FakeSevenZipStream<string>() as unknown as SevenZipStream<string>;
    const promise = runSevenZip(stream, 'List archive', 1000);

    stream.emit('data', 'page-1');
    stream.emit('data', 'page-2');
    stream.emit('end');

    await expect(promise).resolves.toEqual(['page-1', 'page-2']);
  });

  it('rejects 7-Zip stream errors with stderr details', async () => {
    const stream = new FakeSevenZipStream<string>() as unknown as SevenZipStream<string>;
    const promise = runSevenZip(stream, 'Extract page', 1000);
    const err = new Error('generic failure') as Error & { stderr?: string };
    err.stderr = 'specific stderr';

    stream.emit('error', err);

    await expect(promise).rejects.toThrow('Extract page failed: specific stderr');
  });

  it('kills and rejects a stalled 7-Zip stream on timeout', async () => {
    vi.useFakeTimers();
    const stream = new FakeSevenZipStream<string>() as unknown as SevenZipStream<string>;
    const promise = runSevenZip(stream, 'Extract page', 50);
    const assertion = expect(promise).rejects.toThrow('Extract page timed out after 50 ms');

    await vi.advanceTimersByTimeAsync(51);

    await assertion;
    expect(stream._childProcess?.kill).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
