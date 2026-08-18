import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type * as http from 'node:http';
import { createLogger } from '../../logger';

/**
 * @module
 * Serve the Built SPA and Its Static Assets
 *
 * Architecture overview for Junior Devs:
 * After the API routes have had their chance, anything left over is a request for
 * the front-end: the built React bundle, CSS, icons, etc. This module serves
 * those files from the static root. Because the SPA uses client-side routing,
 * any unknown non-asset path falls back to `index.html` so deep links work.
 * Path traversal (`../`) is stripped so requests can't escape the static root.
 */

const log = createLogger('webServer:static');

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  // .mjs is a real ES module (e.g. pdfjs-dist's pdf.worker.min.mjs). Serving it
  // as the default application/octet-stream makes the browser refuse the dynamic
  // import ("error loading dynamically imported module"), which breaks the PDF
  // reader's worker. It must carry a JavaScript MIME type.
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve a static file, falling back to the SPA's index.html.
 * Only call this once no API route has matched. Unknown paths resolve to
 * index.html so client-side routes (deep links) load correctly.
 * @param res The response to write to.
 * @param pathname The requested URL path.
 * @param staticRoot Absolute path to the built SPA directory.
 */
export async function serveStatic(
  res: http.ServerResponse,
  pathname: string,
  staticRoot: string,
): Promise<void> {
  const relPath = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const absPath = path.join(staticRoot, safe);

  if (!absPath.startsWith(staticRoot)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const stat = await fsp.stat(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const mime = STATIC_MIME[ext] ?? 'application/octet-stream';
    // Vite emits content-hashed filenames under /assets/ (e.g.
    // index-C8hzdvhv.js), so those bytes never change for a given URL — let
    // browsers cache them forever instead of revalidating every load.
    // Everything else (index.html, manifest.json, favicon) stays no-cache so
    // deploys are picked up immediately.
    const immutable = relPath.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': String(stat.size),
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    const staticStream = fs.createReadStream(absPath);
    staticStream.on('error', (err) => {
      log.error(`Static stream error ${absPath}:`, err);
      staticStream.destroy();
      res.destroy();
    });
    staticStream.pipe(res);
  } catch {
    try {
      const indexPath = path.join(staticRoot, 'index.html');
      const indexStat = await fsp.stat(indexPath);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(indexStat.size),
        'Cache-Control': 'no-cache',
      });
      const indexStream = fs.createReadStream(indexPath);
      indexStream.on('error', (err) => {
        log.error(`Index stream error ${indexPath}:`, err);
        indexStream.destroy();
        res.destroy();
      });
      indexStream.pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  }
}

