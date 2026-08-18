/**
 * copy-web.mjs — copies the built React renderer into packaged resources.
 * Called by forge.config.ts packageAfterCopy hook.
 */
import { cpSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcWeb = join(__dirname, '..', 'dist', 'web');

export function copyWebAssets(appDir) {
  const dest = join(appDir, 'web');
  mkdirSync(dest, { recursive: true });
  cpSync(srcWeb, dest, { recursive: true });
  console.log(`[CB8] Copied dist/web -> ${dest}`);
}
