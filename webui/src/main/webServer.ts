/**
 * @module
 * Public Façade for Starting the Web Server
 *
 * Architecture overview for Junior Devs:
 * The actual server is a Fastify instance built in `./webServer/server.ts`. This
 * thin wrapper exposes `startWebServer(...)`, which builds that instance, starts
 * listening, and hands back a `WebServerHandle` (bundling the underlying
 * `http.Server` and the URLs). Callers — Electron's IPC handlers and the
 * headless startup path — only deal with this handle, so server internals can
 * change without touching them.
 */

import * as http from 'node:http';
import * as os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { LibraryDatabase } from './libraryDatabase';
import { buildServer } from './webServer/server';

export { closeAllHandles } from './webServer/archiveCache';

/**
 * Find the machine's LAN IP address to show the user.
 * Picks the first non-internal IPv4 interface so the settings screen
 * can display a "reachable at http://<ip>:<port>" hint for other devices.
 * @returns A routable IPv4 address, or a loopback fallback if none is found.
 */
export function getLanIp(): string {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (iface.family !== 'IPv4') continue;
      if (iface.internal) continue;
      const parts = iface.address.split('.').map(Number);
      // Skip entire 127.0.0.0/8 loopback block (some virtual adapters mark
      // themselves non-internal but still use a loopback address).
      if (parts[0] === 127) continue;
      // Skip link-local (169.254.x.x).
      if (parts[0] === 169 && parts[1] === 254) continue;
      return iface.address;
    }
  }
  return '127.0.0.1';
}

export interface WebServerHandle {
  server: http.Server;
  fastify: FastifyInstance;
  port: number;
  host: string;
  url: string;
  lanUrl: string;
  ready: Promise<void>;
}

/**
 * Start the web server.
 * @param db    The open LibraryDatabase instance.
 * @param port  TCP port to listen on. Default 8008.
 * @param host  Bind address. Default `0.0.0.0`. Pass `127.0.0.1` for local-only.
 *
 * Note: returns synchronously with a handle whose `server` is the underlying
 * `http.Server`. Listening happens asynchronously; callers that need to know
 * when the bind is complete should listen on `handle.server` events.
 */
export function startWebServer(db: LibraryDatabase, port = 8008, host = '0.0.0.0'): WebServerHandle {
  // Build and listen are async, but our public contract is sync. We expose
  // `server` as the raw http.Server immediately and let listen() resolve in
  // the background. Errors are logged.
  const lan = getLanIp();
  const handle = {
    // Placeholder until Fastify builds its underlying server. Replaced below.
    server: undefined as unknown as http.Server,
    fastify: undefined as unknown as FastifyInstance,
    port,
    host,
    url: `http://localhost:${port}`,
    lanUrl: `http://${lan}:${port}`,
    ready: Promise.resolve(),
  } satisfies WebServerHandle;

  handle.ready = (async () => {
    try {
      const fastify = await buildServer(db);
      handle.fastify = fastify;
      // Trigger Fastify to materialise its underlying http.Server before
      // listening so callers can grab `handle.server` for shutdown.
      await fastify.ready();
      handle.server = fastify.server;

      await fastify.listen({ port, host });
      if (host === '0.0.0.0') {
        console.log(`[CB8] Web UI: http://localhost:${port}`);
        console.log(`[CB8] LAN:    http://${lan}:${port}`);
      } else {
        console.log(`[CB8] Web UI: http://${host}:${port} (local-only)`);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        console.warn(`[CB8] Web server port ${port} already in use. Web UI disabled.`);
      } else {
        console.error('[CB8] Web server error:', err);
      }
    }
  })();

  return handle;
}
