import type { ServerResponse } from 'node:http';
import { sendJson, sendError } from '../middleware';
import { requestBaseUrl } from '../serverHelpers';
import { type RouteHandler } from '../context';
import {
  buildOpdsFeed,
  buildOpenSearchDescription,
  buildPublication,
  parseOpdsPaging,
  OPDS_MIME,
  OPENSEARCH_MIME,
  type OpdsFeedLink,
} from './opdsFeedHelpers';
import type { LibraryDatabase } from '../../libraryDatabase';
import type { QueryOptions, QueryResult } from '../../../shared/types';

/**
 * @module
 * OPDS 2.0 Catalog Routes
 *
 * Serves the library to external reader apps (Thorium, KyBook, KOReader, …) as
 * an OPDS 2 catalog, plus Readium WebPub manifests for reading (see
 * `webpub.ts`). Authentication is session-cookie in the browser or HTTP Basic
 * for machine clients — Basic is resolved in `dispatchApi` before this route
 * runs, so `currentUser` here is the effective (cookie or Basic) user and the
 * normal guest gate still applies.
 *
 *   GET /api/opds                    → root navigation feed (+ continue reading)
 *   GET /api/opds/all                → full catalog, paged
 *   GET /api/opds/continue           → in-progress books, last-read first
 *   GET /api/opds/recent             → recently-read books
 *   GET /api/opds/library/:id        → one collection's books, paged
 *   GET /api/opds/search/opensearch.xml → OpenSearch description
 *   GET /api/opds/search?q=…         → metadata search results
 *
 * Publications carry reading progress as extended metadata (`percentRead`,
 * `lastPage`, `lastLocation`, `lastReadAt`) so a reader app can resume where
 * the user left off across all CB8 clients.
 */
export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, query, currentUser } = ctx;
  if (method !== 'GET' || !pathname.startsWith('/api/opds')) return false;

  const baseUrl = requestBaseUrl(
    req.headers.host,
    req.headers['x-forwarded-host'],
    req.headers['x-forwarded-proto'],
  );
  const userId = currentUser?.id ?? null;
  const admin = currentUser?.isAdmin === true;

  // OpenSearch description — discovered via the root feed's `search` link.
  if (pathname === '/api/opds/search/opensearch.xml') {
    res.writeHead(200, { 'Content-Type': OPENSEARCH_MIME, 'Cache-Control': 'public, max-age=3600' });
    res.end(buildOpenSearchDescription(baseUrl));
    return true;
  }

  // Root: navigation to every catalog plus the continue-reading subset, so a
  // client that only fetches the root still gets something useful to show.
  if (pathname === '/api/opds') {
    const libraries = await db.getAllLibraries(undefined, userId, admin);
    const links: OpdsFeedLink[] = [
      { rel: 'subsection', href: `${baseUrl}/api/opds/all`, type: OPDS_MIME, title: 'All books' },
      { rel: 'subsection', href: `${baseUrl}/api/opds/continue`, type: OPDS_MIME, title: 'Continue reading' },
      { rel: 'subsection', href: `${baseUrl}/api/opds/recent`, type: OPDS_MIME, title: 'Recently read' },
      ...libraries.map((l) => ({
        rel: 'subsection',
        href: `${baseUrl}/api/opds/library/${l.id}`,
        type: OPDS_MIME,
        title: l.name,
      })),
      {
        rel: 'search',
        href: `${baseUrl}/api/opds/search/opensearch.xml`,
        type: OPENSEARCH_MIME,
        title: 'Search',
      },
    ];
    const result = await db.queryComicsForUser(userId, {
      ...(userId != null
        ? { readStatus: 'in-progress', sortBy: 'lastRead', sortOrder: 'desc' }
        : { sortBy: 'lastRead', sortOrder: 'desc' }),
      limit: 20,
      offset: 0,
      admin,
    });
    sendJson(
      res,
      200,
      buildOpdsFeed({
        title: 'CB8',
        baseUrl,
        selfPath: '/api/opds',
        links,
        publications: result.records.map((record) => buildPublication(record, baseUrl)),
      }),
      OPDS_MIME,
    );
    return true;
  }

  // /api/opds/all — the whole catalog, paged.
  if (pathname === '/api/opds/all') {
    await sendCatalogFeed({ res, db, baseUrl, title: 'All books', selfPath: '/api/opds/all', userId, admin, query, options: {} });
    return true;
  }

  // /api/opds/continue — in-progress books, most recently read first.
  if (pathname === '/api/opds/continue') {
    await sendCatalogFeed({
      res, db, baseUrl, title: 'Continue reading', selfPath: '/api/opds/continue', userId, admin, query,
      options: userId != null
        ? { readStatus: 'in-progress' as const, sortBy: 'lastRead' as const, sortOrder: 'desc' as const }
        : { sortBy: 'lastRead' as const, sortOrder: 'desc' as const },
    });
    return true;
  }

  // /api/opds/recent — recently-read books (all states), last-read first.
  if (pathname === '/api/opds/recent') {
    await sendCatalogFeed({
      res, db, baseUrl, title: 'Recently read', selfPath: '/api/opds/recent', userId, admin, query,
      options: { sortBy: 'lastRead' as const, sortOrder: 'desc' as const },
    });
    return true;
  }

  // /api/opds/library/:id — one collection's books, paged.
  const libraryMatch = /^\/api\/opds\/library\/(\d+)$/.exec(pathname);
  if (libraryMatch) {
    const libraryId = parseInt(libraryMatch[1], 10);
    const library = (await db.getAllLibraries(undefined, userId, admin)).find((l) => l.id === libraryId);
    if (!library) {
      sendError(res, 404, 'Collection not found');
      return true;
    }
    await sendCatalogFeed({
      res, db, baseUrl, title: library.name, selfPath: pathname,
      userId, admin, query, options: { libraryId },
    });
    return true;
  }

  // /api/opds/search?q=… — metadata search.
  if (pathname === '/api/opds/search') {
    const q = (typeof query.q === 'string' ? query.q : '').trim();
    if (!q) {
      sendError(res, 400, 'Provide a ?q= search term');
      return true;
    }
    const paging = parseOpdsPaging(query);
    const result = await db.queryComicsForUser(userId, {
      search: q,
      limit: paging.limit,
      offset: paging.offset,
      admin,
    });
    sendPagedFeed({
      res, baseUrl, title: `Search results for "${q}"`, selfPath: pathname, paging, result,
      nextPath: paging.offset + result.records.length < result.totalCount
        ? `${pathname}?q=${encodeURIComponent(q)}&page=${paging.page + 1}&limit=${paging.limit}`
        : undefined,
    });
    return true;
  }

  return false;
};

/**
 * Run a `queryComicsForUser` catalog query and emit a paged OPDS feed.
 * Shared by `/all`, `/continue`, and `/recent`; `options` carries the
 * user-scoped filters/sorts, `query` the paging params.
 */
async function sendCatalogFeed(input: {
  res: ServerResponse;
  db: LibraryDatabase;
  baseUrl: string;
  title: string;
  selfPath: string;
  userId: number | null;
  admin: boolean;
  query: Record<string, string>;
  options: QueryOptions & { libraryId?: number };
}): Promise<void> {
  const { res, db, baseUrl, title, selfPath, userId, admin, query, options } = input;
  const paging = parseOpdsPaging(query);
  const result = await db.queryComicsForUser(userId, {
    ...options,
    limit: paging.limit,
    offset: paging.offset,
    admin,
  });
  sendPagedFeed({
    res, baseUrl, title, selfPath, paging, result,
    nextPath: paging.offset + result.records.length < result.totalCount
      ? `${selfPath}?page=${paging.page + 1}&limit=${paging.limit}`
      : undefined,
  });
}

/** Emit a paged feed from a QueryResult-shaped response. */
function sendPagedFeed(input: {
  res: ServerResponse;
  baseUrl: string;
  title: string;
  selfPath: string;
  paging: ReturnType<typeof parseOpdsPaging>;
  result: QueryResult;
  nextPath: string | undefined;
}): void {
  const { res, baseUrl, title, selfPath, paging, result, nextPath } = input;
  sendJson(
    res,
    200,
    buildOpdsFeed({
      title,
      baseUrl,
      selfPath,
      paging,
      numberOfItems: result.totalCount,
      nextPath,
      publications: result.records.map((record) => buildPublication(record, baseUrl)),
    }),
    OPDS_MIME,
  );
}
