import * as bcrypt from 'bcryptjs';
import { sendJson, sendError } from '../middleware';
import { requireAdmin, type RouteHandler } from '../context';
import { readJsonBody, requireString, requireTrimmedString } from './validation';
import {
  deleteUserBlockReason,
  normalizeAdminFlag,
  setRoleBlockReason,
} from './userRouteHelpers';

/**
 * @module
 * HTTP Route Handlers for User Management (admin)
 *
 * Architecture overview for Junior Devs:
 * Serves the admin-only `/api/users/*` endpoints: listing users, creating them,
 * resetting passwords, toggling admin rights, and deleting accounts. Almost
 * every branch is gated by `requireAdmin(ctx)`. Because passwords must work with
 * `better-auth`, writes go through DB helpers that also sync the `account` table
 * (see `db/users.ts`'s `upsertCredentialAccount`). Returns `true` once it owns
 * the request.
 */

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, currentUser } = ctx;

  // List users
  if (method === 'GET' && pathname === '/api/users') {
    if (!requireAdmin(ctx)) return true;
    sendJson(res, 200, await db.listUsers());
    return true;
  }

  // Create user
  if (method === 'POST' && pathname === '/api/users') {
    if (!requireAdmin(ctx)) return true;
    const parsed = await readJsonBody<{ username?: unknown; password?: unknown; isAdmin?: unknown }>(req, res);
    if (!parsed.ok) return true;
    const username = requireTrimmedString(res, parsed.value.username, 'username');
    if (!username) return true;
    const password = requireString(res, parsed.value.password, 'password');
    if (!password) return true;
    if (await db.getUserByUsername(username)) { sendError(res, 409, 'Username already exists'); return true; }
    const hash = await bcrypt.hash(password, 10);
    const user = await db.createUser(username, hash, normalizeAdminFlag(parsed.value.isAdmin));
    // Bridge to better-auth's account table so the new user can actually sign in
    // (createUser alone only populates our users row). Mirrors /api/auth/register.
    await db.upsertCredentialAccount(user.id, username, hash);
    sendJson(res, 201, user);
    return true;
  }

  // Delete user
  const userIdMatch = pathname.match(/^\/api\/users\/(\d+)$/);
  if (method === 'DELETE' && userIdMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(userIdMatch[1], 10);
    const target = await db.getUserById(id);
    const blocked = deleteUserBlockReason(currentUser?.id, id, target, await db.countAdmins());
    if (blocked.blocked) { sendError(res, blocked.status, blocked.message); return true; }
    await db.deleteUser(id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Set role
  const userRoleMatch = pathname.match(/^\/api\/users\/(\d+)\/role$/);
  if (method === 'PUT' && userRoleMatch) {
    if (!requireAdmin(ctx)) return true;
    const id = parseInt(userRoleMatch[1], 10);
    const parsed = await readJsonBody<{ isAdmin?: unknown }>(req, res);
    if (!parsed.ok) return true;
    const nextIsAdmin = normalizeAdminFlag(parsed.value.isAdmin);
    const target = await db.getUserById(id);
    const blocked = setRoleBlockReason(target, nextIsAdmin, await db.countAdmins());
    if (blocked.blocked) { sendError(res, blocked.status, blocked.message); return true; }
    await db.setUserAdmin(id, nextIsAdmin);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
};
