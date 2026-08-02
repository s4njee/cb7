import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

/**
 * @module
 * Archive Process Helpers
 *
 * Architecture overview for Junior Devs:
 * Some archive backends are external programs (`unrar` or `7z`) instead of
 * plain TypeScript libraries. This module keeps the generic process plumbing in
 * one place: parsing timeout environment variables, collecting stdout from a
 * spawned command, and turning node-7z streams into Promise results with a
 * timeout. The archive loader can then focus on archive-specific behavior.
 */

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_COMMAND_MAX_BUFFER = 50 * 1024 * 1024;

export type SevenZipStream<T> = Readable & {
  _childProcess?: ChildProcess;
  on(event: 'data', listener: (data: T) => void): SevenZipStream<T>;
  on(event: 'error', listener: (err: Error) => void): SevenZipStream<T>;
  on(event: 'end', listener: () => void): SevenZipStream<T>;
};

export function readPositiveIntEnv(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Run a command and return stdout as a Buffer.
 * Rejects with stderr content on non-zero exit or spawn failure.
 */
export function spawnToBuffer(
  file: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { timeout = DEFAULT_COMMAND_TIMEOUT_MS, maxBuffer = DEFAULT_COMMAND_MAX_BUFFER } = opts;
    // execFile's encoding:'buffer' overload is difficult to express cleanly in
    // TypeScript, so the call is narrowed at the callback boundary below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (execFile as any)(
      file,
      args,
      { timeout, maxBuffer, encoding: 'buffer' },
      (err: Error | null, stdout: Buffer, stderr: Buffer) => {
        if (err) {
          const execErr = err as Error & { killed?: boolean };
          if (execErr.killed) {
            reject(new Error(`${file} ${args.join(' ')} timed out after ${timeout} ms`));
            return;
          }
          reject(new Error(stderr?.length ? stderr.toString().trim() : err.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export function runSevenZip<T>(stream: SevenZipStream<T>, action: string, timeoutMs: number): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const records: T[] = [];
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };
    timeout = setTimeout(() => {
      stream._childProcess?.kill();
      finish(() => reject(new Error(`${action} timed out after ${timeoutMs} ms`)));
    }, timeoutMs);
    stream.on('data', (data) => records.push(data));
    stream.on('error', (err) => {
      const stderr = (err as Error & { stderr?: string }).stderr?.trim();
      finish(() => reject(new Error(`${action} failed: ${stderr || err.message}`)));
    });
    stream.on('end', () => finish(() => resolve(records)));
  });
}
