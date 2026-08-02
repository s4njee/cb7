/**
 * @module
 * On-Demand Image Resizing With a Bounded Disk Cache
 *
 * Architecture overview for Junior Devs:
 * Comic pages are often huge; sending the full-resolution image to every device
 * would be slow. This module uses the `sharp` library to resize a page (or
 * thumbnail) to the requested width on the fly, then caches the result on disk
 * under `<userData>/image-cache/`, keyed by `(comicId, page, width)`, so the
 * expensive resize happens only once.
 *
 * The cache can't grow forever: when its total size exceeds `CACHE_BUDGET`, the
 * oldest files (by modification time) are evicted until it's back under budget.
 * Eviction runs lazily — only triggered by a write that pushes it over.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

let cacheRootDir: string | null = null;

/**
 * Set where resized images are cached on disk.
 * Call once at startup. When left unset, the cache falls back to the OS
 * temp directory so importing this module (and tests) never crash.
 * @param dir Cache directory, typically `<userData>/image-cache`.
 */
export function setImageCacheRoot(dir: string): void {
  cacheRootDir = dir;
}

let sharp: typeof import('sharp') | null = null;
function getSharp(): typeof import('sharp') {
  if (!sharp) {
    // Lazy require so the module doesn't explode at import time in envs
    // where the native binding hasn't been built.
    sharp = require('sharp');
  }
  return sharp!;
}

export const MIN_WIDTH = 200;
export const MAX_WIDTH = 4000;

const CACHE_BUDGET_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB hard cap
const CACHE_EVICT_TARGET = 1.6 * 1024 * 1024 * 1024; // evict down to 1.6 GiB
let trackedBytes = -1; // -1 until first scan populates it
let evictionInFlight = false;

/**
 * Clamp a requested width into the supported `[MIN_WIDTH, MAX_WIDTH]` range.
 * Guards against absurd or non-numeric inputs from the API so we never
 * ask `sharp` to produce a 1px or 100000px image.
 * @param w The requested width.
 * @returns A safe, floored width within range.
 */
export function clampWidth(w: number): number {
  if (!Number.isFinite(w)) return MIN_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(w)));
}

function cacheRoot(): string {
  return cacheRootDir ?? path.join(os.tmpdir(), 'cb8-image-cache');
}

interface CachedFile {
  absPath: string;
  size: number;
  mtimeMs: number;
}

async function scanCache(root: string): Promise<CachedFile[]> {
  const out: CachedFile[] = [];
  let topLevel: string[];
  try { topLevel = await fsp.readdir(root); } catch { return out; }
  for (const sub of topLevel) {
    const subPath = path.join(root, sub);
    let files: string[];
    try { files = await fsp.readdir(subPath); } catch { continue; }
    for (const name of files) {
      const abs = path.join(subPath, name);
      try {
        const st = await fsp.stat(abs);
        if (st.isFile()) out.push({ absPath: abs, size: st.size, mtimeMs: st.mtimeMs });
      } catch { /* file removed mid-scan */ }
    }
  }
  return out;
}

async function evictIfOverBudget(root: string): Promise<void> {
  if (evictionInFlight) return;
  if (trackedBytes >= 0 && trackedBytes <= CACHE_BUDGET_BYTES) return;
  evictionInFlight = true;
  try {
    const files = await scanCache(root);
    const actual = files.reduce((acc, f) => acc + f.size, 0);
    trackedBytes = actual;
    if (actual <= CACHE_BUDGET_BYTES) return;
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let running = actual;
    for (const f of files) {
      if (running <= CACHE_EVICT_TARGET) break;
      try { await fsp.unlink(f.absPath); running -= f.size; } catch { /* ignore */ }
    }
    trackedBytes = running;
  } finally {
    evictionInFlight = false;
  }
}

function cachePath(comicId: number, page: number, width: number, ext: string): string {
  const root = cacheRoot();
  const hash = crypto.createHash('sha1').update(`${comicId}:${page}:${width}`).digest('hex').slice(0, 16);
  return path.join(root, `${comicId}`, `${hash}-${width}${ext}`);
}

async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

/**
 * Resize an image buffer to a target width, never enlarging it.
 * @param input The original image bytes.
 * @param width Desired width in pixels (clamped to an allowed range).
 * @returns The resized image bytes.
 */
export async function resizeImage(input: Buffer, width: number): Promise<Buffer> {
  const w = clampWidth(width);
  return await getSharp()(input).resize({ width: w, withoutEnlargement: true }).toBuffer();
}

/**
 * Return a cached resized image, or produce and cache one on a miss.
 *
 * On a cache miss it calls `getOriginal()` to fetch the source bytes
 * (this is how the caller stays decoupled from where the image comes from),
 * resizes to WebP, writes it to the disk cache, and triggers budget-based
 * eviction in the background. If caching fails for any reason it still returns
 * the resized image — the cache is best-effort.
 *
 * @param comicId The comic the page belongs to.
 * @param page Zero-based page index.
 * @param width Desired width in pixels (clamped).
 * @param getOriginal Lazily fetches the full-size source image on a cache miss.
 * @returns The resized image bytes plus its file extension (without the dot).
 */
export async function getCachedOrResize(
  comicId: number,
  page: number,
  width: number,
  getOriginal: () => Promise<{ buffer: Buffer; ext: string }>,
): Promise<{ buffer: Buffer; ext: string }> {
  const w = clampWidth(width);
  // Check cache (we try a few common extensions)
  for (const ext of ['.webp', '.jpg', '.png']) {
    const p = cachePath(comicId, page, w, ext);
    try {
      const buf = await fsp.readFile(p);
      return { buffer: buf, ext: ext.slice(1) };
    } catch { /* miss */ }
  }
  const orig = await getOriginal();
  const resized = await resizeImage(orig.buffer, w);
  const outExt = '.webp';
  const outPath = cachePath(comicId, page, w, outExt);
  try {
    await ensureDir(path.dirname(outPath));
    // Re-encode to webp for space if not already; sharp default preserves format.
    // We used resize without setting format, so use webp explicitly.
    const webpBuf = await getSharp()(orig.buffer).resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    await fsp.writeFile(outPath, webpBuf);
    // Track size and evict in the background if we're over budget. Errors in
    // eviction are non-fatal — the cache is best-effort.
    if (trackedBytes < 0) {
      // Lazy init — the first write in this process triggers a full scan so
      // we pick up files carried over from prior sessions.
      void evictIfOverBudget(cacheRoot());
    } else {
      trackedBytes += webpBuf.length;
      if (trackedBytes > CACHE_BUDGET_BYTES) void evictIfOverBudget(cacheRoot());
    }
    return { buffer: webpBuf, ext: 'webp' };
  } catch {
    // If caching failed, still return the resized buffer
    return { buffer: resized, ext: orig.ext };
  }
}

/**
 * Drop all cached resized images for one comic.
 * Called when a comic's pages change (e.g. re-import) so stale images
 * aren't served. Failures are ignored — the cache will simply rebuild.
 * @param comicId The comic whose cached images should be removed.
 */
export function invalidateCacheForComic(comicId: number): void {
  const dir = path.join(cacheRoot(), String(comicId));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  // Re-scan on next write — the delete removes bytes we were tracking.
  trackedBytes = -1;
}

// --- GPU-upscaled page cache (Real-ESRGAN output) -------------------------
// Kept separate from the resize cache: upscaled pages are GPU-expensive to make,
// so this cache lives on a persistent volume (survives restarts) with a larger
// budget. Same LRU-by-mtime eviction.

let upscaleCacheRootDir: string | null = null;

/** Set where GPU-upscaled pages are cached (a persistent volume in prod). */
export function setUpscaleCacheRoot(dir: string): void {
  upscaleCacheRootDir = dir;
}

function upscaleCacheRoot(): string {
  return upscaleCacheRootDir ?? path.join(os.tmpdir(), 'cb8-upscale-cache');
}

const UPSCALE_BUDGET_BYTES = 40 * 1024 * 1024 * 1024; // 40 GiB
const UPSCALE_EVICT_TARGET = 32 * 1024 * 1024 * 1024; // evict down to 32 GiB
let upscaleTrackedBytes = -1;
let upscaleEvictionInFlight = false;

async function evictUpscaleIfOverBudget(): Promise<void> {
  if (upscaleEvictionInFlight) return;
  if (upscaleTrackedBytes >= 0 && upscaleTrackedBytes <= UPSCALE_BUDGET_BYTES) return;
  upscaleEvictionInFlight = true;
  try {
    const root = upscaleCacheRoot();
    const files = await scanCache(root);
    const actual = files.reduce((acc, f) => acc + f.size, 0);
    upscaleTrackedBytes = actual;
    if (actual <= UPSCALE_BUDGET_BYTES) return;
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let running = actual;
    for (const f of files) {
      if (running <= UPSCALE_EVICT_TARGET) break;
      try { await fsp.unlink(f.absPath); running -= f.size; } catch { /* ignore */ }
    }
    upscaleTrackedBytes = running;
  } finally {
    upscaleEvictionInFlight = false;
  }
}

function upscaleCachePath(comicId: number, page: number): string {
  const hash = crypto.createHash('sha1').update(`${comicId}:${page}:anime2x`).digest('hex').slice(0, 16);
  return path.join(upscaleCacheRoot(), `${comicId}`, `${hash}.webp`);
}

/**
 * Return a cached upscaled page, or upscale + cache one on a miss. `upscaleFn`
 * posts the original bytes to the GPU service and returns the upscaled WebP.
 *
 * If upscaling fails for any reason (service down, GPU fault, decode error), it
 * falls back to a normal resized WebP page so the reader never breaks — and does
 * NOT cache that fallback, so it retries upscaling once the service is back.
 */
export async function getCachedOrUpscale(
  comicId: number,
  page: number,
  getOriginal: () => Promise<{ buffer: Buffer; ext: string }>,
  upscaleFn: (input: Buffer) => Promise<Buffer>,
): Promise<{ buffer: Buffer; ext: string }> {
  const p = upscaleCachePath(comicId, page);
  try {
    const buf = await fsp.readFile(p);
    return { buffer: buf, ext: 'webp' };
  } catch { /* miss */ }

  const orig = await getOriginal();
  let upscaled: Buffer;
  try {
    upscaled = await upscaleFn(orig.buffer);
  } catch {
    // Upscale unavailable/failed — serve a normal page (uncached, retried later).
    const fallback = await getSharp()(orig.buffer)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { buffer: fallback, ext: 'webp' };
  }

  try {
    await ensureDir(path.dirname(p));
    await fsp.writeFile(p, upscaled);
    if (upscaleTrackedBytes < 0) {
      void evictUpscaleIfOverBudget();
    } else {
      upscaleTrackedBytes += upscaled.length;
      if (upscaleTrackedBytes > UPSCALE_BUDGET_BYTES) void evictUpscaleIfOverBudget();
    }
  } catch { /* cache is best-effort */ }
  return { buffer: upscaled, ext: 'webp' };
}
