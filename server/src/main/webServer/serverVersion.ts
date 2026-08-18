import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @module
 * Running CB8 version (package.json `version`).
 *
 * Resolved once and cached. The bundled server (`dist/standalone.mjs`) has
 * `__dirname` defined by the build banner, so the package.json next to the
 * bundle is found wherever the image runs; `process.cwd()` covers dev/source
 * runs. Any other location degrades to "unknown" rather than throwing.
 */

let cached: string | null = null;

export function serverVersion(): string {
  if (cached) return cached;
  const candidates = [
    join(process.cwd(), 'package.json'),
    join(__dirname, 'package.json'),
    join(__dirname, '../package.json'),
    join(__dirname, '../../package.json'),
  ];
  for (const file of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: string };
      if (pkg.version) {
        cached = pkg.version;
        return cached;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return 'unknown';
}
