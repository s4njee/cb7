/**
 * @module
 * Electron-Free Entry Point (Docker / VPS)
 *
 * Architecture overview for Junior Devs:
 * This is one of the app's three entry points. Unlike `index.ts` (the Electron
 * desktop/headless entry), this one has no Electron at all — no window, no IPC,
 * no menu. It connects to Postgres and starts the Fastify web server. It's what
 * runs inside the slim Docker image and on a plain server.
 *
 * Configuration comes entirely from environment variables:
 *   - DATABASE_URL : Postgres connection string, e.g. postgres://u:pw@host:5432/cb8 (required)
 *   - CB8_DATA_DIR : directory for image cache and uploads (default /var/lib/cb8)
 *   - CB8_PORT     : TCP port to listen on (default 8008)
 *   - CB8_HOST     : bind address (default 0.0.0.0)
 *   - CB8_MDNS     : set to 0 to disable LAN discovery advertisement (default on;
 *                    the Docker image presets 0 — see packaging/docker/Dockerfile)
 */

import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { LibraryDatabase } from './libraryDatabase';
import { setImageCacheRoot, setUpscaleCacheRoot } from './imageResizer';
import { setUploadRoot } from './webServer/routes/upload';
import { buildServer } from './webServer/server';
import { startBoss, stopBoss } from './jobs/boss';
import { startMdns, stopMdns } from './mdns';

/**
 * Read the server version out of package.json.
 *
 * This module only ever runs bundled (`dist/standalone.mjs`), so package.json is
 * one level up — both in the repo and in the image, which copies it to
 * /app/package.json next to /app/dist/. The extra candidate covers an unbundled
 * run straight from `src/main/`. Purely cosmetic on failure: the version is a
 * TXT record, not a dependency.
 *
 * @returns The package version, or `'0.0.0'` if package.json cannot be found.
 */
function readServerVersion(): string {
  const requireFrom = createRequire(import.meta.url);
  for (const candidate of ['../package.json', '../../package.json']) {
    try {
      const version = (requireFrom(candidate) as { version?: string }).version;
      if (version) return version;
    } catch {
      /* try the next candidate */
    }
  }
  return '0.0.0';
}

/**
 * The display name this instance advertises on the LAN.
 *
 * `app_meta.server_name` when an admin has set one (so two servers on one LAN
 * are tellable apart), else the machine hostname.
 *
 * @param db The connected database handle.
 * @returns The configured server name, or `os.hostname()`.
 */
async function resolveServerName(db: LibraryDatabase): Promise<string> {
  try {
    const configured = (await db.getAppMeta('server_name'))?.trim();
    if (configured) return configured;
  } catch (err) {
    console.warn('[CB8] Could not read app_meta.server_name; using the hostname:', err);
  }
  return os.hostname();
}

async function main(): Promise<void> {
  const dataDir = process.env.CB8_DATA_DIR ?? '/var/lib/cb8';
  const port = parseInt(process.env.CB8_PORT ?? '8008', 10);
  const host = process.env.CB8_HOST ?? '0.0.0.0';

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (a Postgres connection string).');
  }

  setImageCacheRoot(path.join(dataDir, 'image-cache'));
  setUpscaleCacheRoot(process.env.CB8_UPSCALE_CACHE_DIR ?? path.join(dataDir, 'upscale-cache'));
  setUploadRoot(dataDir);

  console.log('[CB8] Standalone startup: connecting to Postgres');
  const db = new LibraryDatabase(databaseUrl);
  await db.initialize();
  console.log('[CB8] Standalone startup: database ready');

  // Producer-only pg-boss: the API only enqueues jobs (scans, backfills); the
  // separate cb8-worker process drains them. No maintenance/cron runs here.
  await startBoss(databaseUrl, { producerOnly: true });

  const fastify = await buildServer(db);
  await fastify.listen({ port, host });
  console.log(`[CB8] Web UI listening on http://${host}:${port}`);

  // Announce ourselves on the LAN so client apps can find this server without
  // the user typing an IP. Strictly after listen(): the SRV record needs the
  // port we actually bound (CB8_PORT=0 asks the OS to pick one). Never fatal —
  // startMdns swallows its own failures; QR/manual pairing is the fallback.
  const address = fastify.server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  await startMdns({
    port: boundPort,
    name: await resolveServerName(db),
    version: readServerVersion(),
  });

  const shutdown = async (): Promise<void> => {
    console.log('[CB8] Shutting down…');
    try { await stopMdns(); } catch { /* ignore */ }
    try { await fastify.close(); } catch { /* ignore */ }
    try { await stopBoss(); } catch { /* ignore */ }
    try { await db.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

main().catch((err) => {
  console.error('[CB8] Standalone startup failed:', err);
  process.exit(1);
});
