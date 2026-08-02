import * as http from 'node:http';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type { LibraryDatabase } from '../libraryDatabase';
import type { QueryOptions } from '../../shared/types';

/**
 * @module
 * Shared HTTP Request/Response Helpers and Access Policy
 *
 * Architecture overview for Junior Devs:
 * The route handlers stay small because the cross-cutting plumbing lives here:
 * parsing cookies, reading and size-limiting request bodies, deciding guest
 * access, bootstrapping the first admin account, and the `sendJson` / `sendError`
 * helpers every route uses to reply. If several routes need the same low-level
 * behavior, it usually belongs in this file.
 */

export const GUEST_ACCESS_KEY = 'guest_access';

/**
 * Optional CORS origin allowed to call the API.
 * The SPA is served from the same origin, so no cross-origin access is
 * needed by default. Set `CB8_CORS_ORIGIN` to allow another origin (or "*" for
 * legacy trusted-LAN behavior).
 */
export const CORS_ORIGIN = process.env.CB8_CORS_ORIGIN?.trim() ?? '';

/**
 * 18 bytes → 24 url-safe base64 chars. Enough entropy that the password is
 * useful as the only credential on first boot, short enough to retype.
 */
function generateInitialAdminPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}

/**
 * "Superadmin" = authenticated admin whose connection originates from the
 * host machine itself (loopback). Host-path features require this because
 * paths only make sense for someone sitting at the server.
 */
export function isHostConnection(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export interface ResolvedUser {
  id: number;
  username: string;
  isAdmin: boolean;
}

// The guest-access flag is read on every API request but changes only when an
// admin toggles it, so cache it per-db and invalidate on write rather than
// hitting app_meta each time. Keyed by the db instance so multiple databases
// (e.g. in tests) don't share state.
const guestAccessCache = new WeakMap<LibraryDatabase, boolean>();

export async function isGuestAccessEnabled(db: LibraryDatabase): Promise<boolean> {
  const cached = guestAccessCache.get(db);
  if (cached !== undefined) return cached;
  // Default: guests can read. Only disabled if an admin explicitly sets 'false'.
  const enabled = (await db.getAppMeta(GUEST_ACCESS_KEY)) !== 'false';
  guestAccessCache.set(db, enabled);
  return enabled;
}

/** Drop the cached guest-access flag so the next read reflects a fresh write. */
export function invalidateGuestAccessCache(db: LibraryDatabase): void {
  guestAccessCache.delete(db);
}

export async function ensureInitialAdmin(db: LibraryDatabase): Promise<void> {
  if ((await db.countUsers()) === 0) {
    await _createInitialAdmin(db);
    return;
  }
  // Migration: admin exists but initial_password was never stored (created
  // before this feature). Reset it so the operator still has recoverable
  // first-run credentials available in settings / logs.
  const stored = await db.getAppMeta('initial_password');
  if (stored === null) {
    await _resetInitialPassword(db);
  }
}

async function _createInitialAdmin(db: LibraryDatabase): Promise<void> {
  const password = generateInitialAdminPassword();
  const hash = bcrypt.hashSync(password, 10);
  const user = await db.createUser('admin', hash, true);
  // better-auth's username plugin validates the returned user shape on
  // sign-in and rejects rows where email / display_username / name are null.
  // Populate them up front so /api/auth/sign-in/username succeeds without
  // further surgery.
  await db.pool.query(
    `UPDATE users
        SET email = 'admin@localhost',
            email_verified = true,
            display_username = 'admin',
            name = 'admin',
            updated_at = now()
      WHERE id = $1`,
    [user.id],
  );
  await db.upsertCredentialAccount(user.id, 'admin', hash);
  await db.setAppMeta('initial_password', password);
  _printPasswordBanner(password, 'Initial admin account created.');
}

async function _resetInitialPassword(db: LibraryDatabase): Promise<void> {
  const admin = await db.getUserByUsername('admin');
  if (!admin) return;
  const password = generateInitialAdminPassword();
  const hash = bcrypt.hashSync(password, 10);
  await db.pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, admin.id]);
  await db.upsertCredentialAccount(admin.id, 'admin', hash);
  await db.setAppMeta('initial_password', password);
  _printPasswordBanner(password, 'Admin password reset (initial_password not set).');
}

function _printPasswordBanner(password: string, headline: string): void {
  // Deliberate direct-to-stdout banner: first-run admin credentials must always
  // be visible to the operator regardless of CB8_LOG_LEVEL, and the multi-line
  // formatting would be mangled by the logger's per-line `[CB8:scope]` prefix.
  const banner = '='.repeat(60);
  console.log(`\n${banner}`);
  console.log(`[CB8] ${headline}`);
  console.log('      username: admin');
  console.log(`      password: ${password}`);
  console.log('      Sign in and change this password immediately.');
  console.log(`${banner}\n`);
}

export function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  contentType = 'application/json',
): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    'Content-Type': contentType,
  };
  if (CORS_ORIGIN) headers['Access-Control-Allow-Origin'] = CORS_ORIGIN;
  res.writeHead(status, headers);
  res.end(payload);
}

export function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

export function parseQueryOptions(query: Record<string, string>): QueryOptions {
  const options: QueryOptions = {};
  if (query.search) options.search = query.search;
  if (query.tag) options.tag = query.tag;
  if (query.sortBy) options.sortBy = query.sortBy as QueryOptions['sortBy'];
  if (query.sortOrder) options.sortOrder = query.sortOrder as 'asc' | 'desc';
  if (query.offset) options.offset = parseInt(query.offset, 10);
  if (query.limit) options.limit = Math.min(parseInt(query.limit, 10), 200);
  if (query.mediaType) options.mediaType = query.mediaType as 'comic' | 'book';
  if (query.excludeFoldered) options.excludeFoldered = query.excludeFoldered === 'true';
  if (query.fileExt) options.fileExt = String(query.fileExt).toLowerCase().replace(/^\./, '');
  return options;
}

const DEFAULT_BODY_LIMIT = 1_048_576; // 1 MiB

export class BodyTooLargeError extends Error {
  readonly statusCode = 413;
  constructor(limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

export async function readBody(req: http.IncomingMessage, maxBytes = DEFAULT_BODY_LIMIT): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        req.destroy();
        reject(new BodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
