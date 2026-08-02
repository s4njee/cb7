#!/usr/bin/env node
/**
 * build-standalone.mjs — bundle the server entry points to dist/*.mjs.
 *
 *   src/main/standalone.ts → dist/standalone.mjs   (Fastify web server / API)
 *   src/main/worker.ts     → dist/worker.mjs        (pg-boss background worker)
 *
 * Both ship in the same Docker image; the container chooses which to run via its
 * command. All node_modules deps stay external (resolved at runtime against the
 * installed node_modules tree). Only first-party TypeScript is bundled.
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const externals = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
  'sharp',
  'bindings',
  'node-7z',
  'yauzl',
  '@jsquash/jxl',
  '@napi-rs/canvas',
  'pdfjs-dist',
];

const entries = [
  { in: 'src/main/standalone.ts', out: 'dist/standalone.mjs' },
  { in: 'src/main/worker.ts', out: 'dist/worker.mjs' },
];

for (const entry of entries) {
  await build({
    entryPoints: [join(root, entry.in)],
    outfile: join(root, entry.out),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    external: [...new Set(externals)],
    logLevel: 'info',
    banner: {
      // Make CJS-only deps requireable from this ESM bundle, and emit a shebang.
      js: [
        '#!/usr/bin/env node',
        "import { createRequire as __cb8_createRequire } from 'node:module';",
        "import { fileURLToPath as __cb8_fileURLToPath } from 'node:url';",
        "import { dirname as __cb8_dirname } from 'node:path';",
        'const require = __cb8_createRequire(import.meta.url);',
        'const __filename = __cb8_fileURLToPath(import.meta.url);',
        'const __dirname = __cb8_dirname(__filename);',
      ].join('\n'),
    },
  });
  console.log(`[build-standalone] ${entry.out} ready`);
}
