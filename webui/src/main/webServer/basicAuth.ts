import * as bcrypt from 'bcryptjs';
import type { LibraryDatabase } from '../libraryDatabase';
import type { ResolvedUser } from './middleware';

/**
 * @module
 * HTTP Basic-auth resolution for machine clients (OPDS / WebPub apps).
 *
 * Browser sessions use cookies; an external reader app cannot hold one, so OPDS
 * endpoints also accept `Authorization: Basic`. This module parses the header
 * and verifies the credentials against the same `users` table the login route
 * uses — an app that can sign in with a username + password in the browser can
 * sign in here too. Passwords are compared with bcrypt (constant-ish work), so
 * the cost is the same as a login.
 */

/** Parse a `Basic` header into its decoded username/password, or null if malformed. */
export function parseBasicAuthHeader(
  header: string | string[] | undefined | null,
): { username: string; password: string } | null {
  if (!header) return null;
  const raw = Array.isArray(header) ? header[0] : header;
  const match = /^Basic\s+(.+)$/i.exec(raw.trim());
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
  // The separator is the first ':' (usernames can't contain one in this model).
  const sep = decoded.indexOf(':');
  if (sep <= 0) return null; // empty username
  return { username: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

/**
 * Resolve a Basic header to a real user.
 * @returns The matching {@link ResolvedUser}, or `null` when the header is
 *          absent, malformed, or the credentials are wrong.
 */
export async function resolveBasicAuthUser(
  db: LibraryDatabase,
  header: string | string[] | undefined | null,
): Promise<ResolvedUser | null> {
  const creds = parseBasicAuthHeader(header);
  if (!creds) return null;
  const user = await db.getUserByUsername(creds.username);
  if (!user) return null;
  const ok = await bcrypt.compare(creds.password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, username: user.username, isAdmin: user.isAdmin };
}
