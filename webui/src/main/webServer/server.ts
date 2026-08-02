/**
 * @module
 * Fastify-based web server for CB8
 * 
 * Architecture overview for Junior Devs:
 * The backend embeds a Fastify web server to serve the React SPA and handle API requests.
 * This is crucial because headless servers (like a Docker deployment) and the desktop Electron app 
 * both share the exact same HTTP-based API for their React frontend.
 * 
 * Routing architecture:
 * We use `fastify` as a robust shell to handle static file serving, CORS, and limits.
 * However, the custom `/api/*` logic is dispatched to raw Node `http` handlers via the 
 * `dispatchApi` adapter. This is a temporary stepping stone while legacy routes are incrementally 
 * migrated to native Fastify plugins.
 */
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as url from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import type { LibraryDatabase } from '../libraryDatabase';
import {
  isGuestAccessEnabled,
  ensureInitialAdmin,
  sendError,
  BodyTooLargeError,
  CORS_ORIGIN,
  type ResolvedUser,
} from './middleware';
import { createLogger } from '../logger';
import { createAuth, getAuth } from './auth';
import type { RequestContext, RouteHandler } from './context';
import * as authRoutes from './routes/auth';
import * as userRoutes from './routes/users';
import * as tagRoutes from './routes/tags';
import * as libraryRoutes from './routes/libraries';
import * as folderRoutes from './routes/folders';
import * as progressRoutes from './routes/progress';
import * as comicRoutes from './routes/comics';
import * as uploadRoutes from './routes/upload';
import * as searchRoutes from './routes/search';
import * as jobRoutes from './routes/jobs';
import * as webpubRoutes from './routes/webpub';
import * as opdsRoutes from './routes/opds';
import { serveStatic } from './routes/staticFiles';
import { loginLimiter, forgotPasswordLimiter } from './rateLimit';
import {
  canAccessApiRequest,
  resolveStaticRoot as resolveStaticRootPath,
  shouldDelegateToBetterAuth,
} from './serverHelpers';

const log = createLogger('webServer');

const API_ROUTES: RouteHandler[] = [
  authRoutes.handle,
  userRoutes.handle,
  uploadRoutes.handle,
  comicRoutes.handle,
  webpubRoutes.handle,
  opdsRoutes.handle,
  progressRoutes.handle,
  tagRoutes.handle,
  libraryRoutes.handle,
  folderRoutes.handle,
  searchRoutes.handle,
  jobRoutes.handle,
];

function resolveStaticRoot(): string {
  const resolution = resolveStaticRootPath(__dirname, {
    override: process.env.CB8_WEB_ROOT,
    exists: fs.existsSync,
  });
  for (const warning of resolution.warnings) log.warn(warning);
  return resolution.root;
}

async function resolveCurrentUser(req: http.IncomingMessage): Promise<ResolvedUser | null> {
  try {
    const session = await getAuth().api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (session?.user) {
      const id = typeof session.user.id === 'number' ? session.user.id : parseInt(String(session.user.id), 10);
      if (Number.isFinite(id)) {
        return {
          id,
          username: session.user.username ?? session.user.email,
          isAdmin: session.user.isAdmin === true,
        };
      }
    }
  } catch {
    /* no session */
  }
  return null;
}

/**
 * Adapter: dispatch an /api/* request to the legacy RouteHandler modules
 * 
 * Translates the Fastify request context down to the legacy `IncomingMessage` / `ServerResponse`
 * pair expected by the routes in `src/main/webServer/routes/`.
 */
async function dispatchApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: LibraryDatabase,
  betterAuthHandler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>,
): Promise<void> {
  const parsed = url.parse(req.url ?? '/', true);
  const pathname = decodeURIComponent(parsed.pathname ?? '/');
  const query = parsed.query as Record<string, string>;
  const method = req.method ?? 'GET';

  if (shouldDelegateToBetterAuth(pathname)) {
    try {
      await betterAuthHandler(req, res);
    } catch (err) {
      log.error(`better-auth handler error at ${pathname}:`, err);
      if (!res.headersSent) {
        sendError(res, 500, 'Authentication service error');
      } else {
        res.destroy();
      }
    }
    return;
  }

  const currentUser = await resolveCurrentUser(req);
  const guestEnabled = await isGuestAccessEnabled(db);

  if (!canAccessApiRequest(pathname, method, currentUser, guestEnabled)) {
    return sendError(res, 401, 'Unauthorized');
  }

  const ctx: RequestContext = { req, res, db, pathname, method, query, currentUser, guestEnabled };
  for (const route of API_ROUTES) {
    if (await route(ctx)) return;
  }
  return sendError(res, 404, 'API endpoint not found');
}

export interface BuildServerOptions {
  /** Disable Fastify's request logger. Defaults to true (no logs). */
  silent?: boolean;
}

/**
 * Build a configured Fastify instance. The caller is responsible for calling
 * `.listen({ port, host })` on the returned instance.
 */
export async function buildServer(
  db: LibraryDatabase,
  opts: BuildServerOptions = {},
): Promise<FastifyInstance> {
  await ensureInitialAdmin(db);
  const auth = await createAuth(db.pool);
  const betterAuthHandler = toNodeHandler(auth);

  // Background work (folder auto-rescan, search/page-count backfills) runs in the
  // separate cb8-worker process via pg-boss — not here. The API only enqueues.

  const fastify = Fastify({
    logger: opts.silent === false ? true : false,
    // The legacy handlers consume request bodies themselves via readBody().
    // Disable Fastify body parsing entirely so the raw stream is intact.
    bodyLimit: 50 * 1024 * 1024,
  });

  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined));

  // CORS is opt-in: the bundled SPA is same-origin, so browsers need these
  // headers only when an operator explicitly allows a separate origin.
  fastify.addHook('onSend', async (_req, reply, payload) => {
    if (CORS_ORIGIN) {
      reply.header('Access-Control-Allow-Origin', CORS_ORIGIN);
      reply.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, X-CB8-Filename, X-CB8-Relpath');
    }
    return payload;
  });

  fastify.options('/*', async (_req, reply) => {
    reply.code(204).send();
  });

  // Rate-limit sensitive auth endpoints before any processing.
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST') return;
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const pathname = (request.url ?? '').split('?')[0];
    // Cover both our own /api/auth/login and better-auth's native sign-in routes
    // (the SPA authenticates via /api/auth/sign-in/username). Without the latter,
    // the brute-force cap is trivially bypassed by hitting sign-in directly.
    //
    // `/api/auth/pair` is on the same limiter for the same reason: it exchanges
    // a bearer token for a session, so an unthrottled endpoint would let an
    // attacker grind the token space. `/api/auth/pair-token` is here too — it
    // needs a session to mint, but the cap keeps a compromised session from
    // spraying live credentials into the world.
    if (
      pathname === '/api/auth/login' ||
      pathname === '/api/auth/sign-in/username' ||
      pathname === '/api/auth/sign-in/email' ||
      pathname === '/api/auth/pair' ||
      pathname === '/api/auth/pair-token'
    ) {
      if (!loginLimiter.check(`${ip}:login`)) {
        reply.code(429).send({ error: 'Too many login attempts. Try again later.' });
      }
    } else if (pathname === '/api/auth/forget-password' || pathname === '/api/auth/forgot-password') {
      if (!forgotPasswordLimiter.check(`${ip}:forgot`)) {
        reply.code(429).send({ error: 'Too many password reset requests. Try again later.' });
      }
    }
  });

  // /api/* — adapter dispatch to legacy handlers. Hijack the reply so we can
  // write directly to the raw ServerResponse.
  fastify.all('/api/*', async (request, reply) => {
    reply.hijack();
    try {
      await dispatchApi(request.raw, reply.raw, db, betterAuthHandler);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        if (!reply.raw.headersSent) sendError(reply.raw, 413, err.message);
        else reply.raw.destroy();
        return;
      }
      log.error('Unhandled error:', err);
      if (!reply.raw.headersSent) {
        sendError(reply.raw, 500, 'Internal server error');
      }
    }
  });

  // Static SPA. Use serveStatic for the actual response so we keep MIME-type
  // handling and the index.html fallback identical to the legacy server.
  const staticRoot = resolveStaticRoot();
  fastify.setNotFoundHandler(async (request, reply) => {
    reply.hijack();
    try {
      const parsed = url.parse(request.raw.url ?? '/', true);
      // decodeURIComponent throws URIError on malformed input (e.g. `GET /%`).
      // Since the reply is hijacked, an uncaught throw here leaves the socket
      // with no response written — the request hangs. Guard it and answer 400.
      const pathname = decodeURIComponent(parsed.pathname ?? '/');
      await serveStatic(reply.raw, pathname, staticRoot);
    } catch (err) {
      if (reply.raw.headersSent) {
        reply.raw.destroy();
        return;
      }
      if (err instanceof URIError) {
        sendError(reply.raw, 400, 'Bad request');
      } else {
        log.error('Static handler error:', err);
        sendError(reply.raw, 500, 'Internal server error');
      }
    }
  });

  return fastify;
}
