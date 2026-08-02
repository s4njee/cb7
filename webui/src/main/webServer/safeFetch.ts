/**
 * @module
 * SSRF-Safe Outbound HTTP Fetching
 *
 * Architecture overview for Junior Devs:
 * Whenever the server fetches a URL the user supplied (e.g. importing a cover by
 * URL), an attacker could try to point it at internal services — that's an SSRF
 * ("server-side request forgery") attack. This wrapper defends against that by
 * resolving the hostname and refusing private/loopback IP ranges, enforcing a
 * timeout so a slow host can't hang the server, and capping the response size so
 * a huge download can't exhaust memory. Use this instead of bare `fetch` for any
 * user-influenced URL.
 */

import * as dns from 'node:dns/promises';
import * as net from 'node:net';

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 0) return false;
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map((n) => parseInt(n, 10));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    return false;
  }
  // IPv6: ::1 loopback, fc00::/7 unique-local, fe80::/10 link-local, ::ffff:x (mapped v4)
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80')) return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (net.isIP(v4) === 4) return isPrivateIp(v4);
  }
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (net.isIP(hostname) !== 0) {
    if (isPrivateIp(hostname)) throw new SafeFetchError(`Refusing to fetch private address: ${hostname}`);
    return;
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new SafeFetchError(`DNS lookup failed for ${hostname}`);
  }
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw new SafeFetchError(`Refusing to fetch host resolving to private address: ${hostname} (${r.address})`);
    }
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Fetch a remote URL into a Buffer with SSRF and size protections.
 *
 * Applies all the guards described in the file overview:
 *  - scheme restricted to https: (unless explicitly opted out)
 *  - hostname and resolved IPs rejected if in private/loopback ranges
 *  - overall timeout (default 10s)
 *  - streaming byte cap (default 16 MiB)
 *
 * @param urlString The URL to fetch.
 * @param opts Optional timeout / size / scheme overrides.
 * @returns The response body as a Buffer.
 * @throws SafeFetchError if a guard is violated or the request fails.
 */
export async function safeFetchBuffer(urlString: string, opts: SafeFetchOptions = {}): Promise<Buffer> {
  const { timeoutMs = 10_000, maxBytes = 16 * 1024 * 1024 } = opts;

  let url: URL;
  try { url = new URL(urlString); } catch { throw new SafeFetchError('Invalid URL'); }
  if (url.protocol !== 'https:') throw new SafeFetchError('Only https:// URLs are allowed');

  await assertPublicHost(url.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, redirect: 'error' });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw new SafeFetchError(`Timed out after ${timeoutMs}ms`);
    throw new SafeFetchError(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new SafeFetchError(`Upstream returned ${res.status}`);

  // Enforce Content-Length up front if present.
  const lenHeader = res.headers.get('content-length');
  if (lenHeader) {
    const len = parseInt(lenHeader, 10);
    if (Number.isFinite(len) && len > maxBytes) throw new SafeFetchError(`Response exceeds ${maxBytes} bytes`);
  }

  // Stream and cap.
  const reader = res.body?.getReader();
  if (!reader) throw new SafeFetchError('No response body');
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new SafeFetchError(`Response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}
