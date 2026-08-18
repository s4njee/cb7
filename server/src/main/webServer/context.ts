import type * as http from 'node:http';
import type { LibraryDatabase } from '../libraryDatabase';
import { sendError, type ResolvedUser } from './middleware';

/**
 * @module
 * Per-Request Context and the Route Handler Contract
 *
 * Architecture overview for Junior Devs:
 * Every API request is dispatched to route handlers with a single
 * `RequestContext` object bundling the raw request/response, the database, the
 * parsed path/query, and the resolved current user. A `RouteHandler` returns
 * `true` to claim a request (so the dispatcher stops looking) or `false` to pass.
 * `requireAdmin` is the small gate handlers call to reject non-admins.
 */

/** Everything a route handler needs to serve one request. */
export interface RequestContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  db: LibraryDatabase;
  pathname: string;
  method: string;
  query: Record<string, string>;
  currentUser: ResolvedUser | null;
  guestEnabled: boolean;
}

/** A route handler; resolving to `true` means "I handled this request". */
export type RouteHandler = (ctx: RequestContext) => Promise<boolean>;

/**
 * Admin-only gate for a route.
 * On failure it sends the response itself (401 if not logged in, 403 if
 * logged in but not admin), so the caller should just bail when this returns false.
 * @param ctx The current request context.
 * @returns `true` if the user is an admin; otherwise `false` (response sent).
 */
export function requireAdmin(ctx: RequestContext): boolean {
  const { res, currentUser } = ctx;
  if (!currentUser?.isAdmin) {
    sendError(res, currentUser ? 403 : 401, currentUser ? 'Admin required' : 'Unauthorized');
    return false;
  }
  return true;
}
