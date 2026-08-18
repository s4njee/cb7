import type { MediaRecord } from '../../../shared/types';
import { bookMimeForPath } from './comicRouteHelpers';

/**
 * @module
 * OPDS 2.0 feed construction (pure, unit-testable).
 *
 * The route handlers in `opds.ts` own HTTP concerns (path matching, query
 * parsing, auth resolution); this module owns the OPDS wire shapes. Feeds are
 * built as plain objects matching the OPDS 2.0 spec (application/opds+json):
 * a navigation/root feed links to sub-catalogs via `subsection` links, each
 * catalog feed carries `publications` with pagination metadata, and a search
 * endpoint advertises itself with an OpenSearch description.
 *
 * Reading progress rides along as extended publication metadata (`percentRead`,
 * `lastPage`, `lastLocation`, `lastReadAt`) so an external reader can resume —
 * this is the CB8-specific "progress feed" surface.
 */

export const OPDS_MIME = 'application/opds+json';
export const WEBPUB_MIME = 'application/webpub+json';
export const OPENSEARCH_MIME = 'application/opensearchdescription+xml';

/** Default page size and hard cap for catalog feeds. */
export const OPDS_PAGE_SIZE = 100;
export const OPDS_MAX_PAGE_SIZE = 200;

export interface OpdsPaging {
  /** 1-based page number. */
  page: number;
  limit: number;
  offset: number;
}

/**
 * Parse `?page=` (1-based) and `?limit=` into usable paging values. Malformed
 * or missing values fall back to sensible defaults; limit is capped.
 */
export function parseOpdsPaging(query: Record<string, string>): OpdsPaging {
  const rawPage = parseInt(query.page ?? '1', 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const rawLimit = parseInt(query.limit ?? String(OPDS_PAGE_SIZE), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, OPDS_MAX_PAGE_SIZE)
    : OPDS_PAGE_SIZE;
  return { page, limit, offset: (page - 1) * limit };
}

/** An OPDS 2 publication: metadata plus the link set that drives reading. */
export interface OpdsPublication {
  metadata: Record<string, unknown>;
  links: Array<Record<string, string>>;
}

/**
 * Turn one catalog record into an OPDS 2 publication.
 * Includes a self link to its Readium WebPub manifest (how the app actually
 * reads it), a cover link, an acquisition link for downloadable books, and
 * extended metadata carrying the user's reading progress.
 */
export function buildPublication(record: MediaRecord, baseUrl: string): OpdsPublication {
  const isComic = record.mediaType === 'comic';
  const metadata: Record<string, unknown> = {
    '@type': isComic ? 'http://schema.org/ComicStory' : 'http://schema.org/EBook',
    title: record.title,
    identifier: `cb8:comic:${record.id}`,
  };
  if (record.pageCount) metadata.numberOfPages = record.pageCount;
  // Progress extensions: null-safe so coverless/unstarted records omit them.
  if (record.lastPercent != null) metadata.percentRead = record.lastPercent;
  if (record.lastPage != null) metadata.lastPage = record.lastPage;
  if (record.lastLocation) metadata.lastLocation = record.lastLocation;
  if (record.lastRead) metadata.lastReadAt = record.lastRead;

  const links: Array<Record<string, string>> = [
    { rel: 'self', href: `${baseUrl}/api/comics/${record.id}/manifest`, type: WEBPUB_MIME },
    { rel: 'cover', href: `${baseUrl}/api/comics/${record.id}/thumbnail`, type: 'image/jpeg' },
  ];
  if (!isComic) {
    links.push({
      rel: 'http://opds-spec.org/acquisition',
      href: `${baseUrl}/api/comics/${record.id}/file`,
      type: bookMimeForPath(record.filePath),
    });
  }

  return { metadata, links };
}

export interface OpdsFeedLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
}

export interface OpdsFeedInput {
  title: string;
  baseUrl: string;
  /** The path (with query) this feed was requested at, for the self link. */
  selfPath: string;
  links?: OpdsFeedLink[];
  publications?: ReturnType<typeof buildPublication>[];
  /** Total matching items, when the feed is a paged catalog. */
  numberOfItems?: number;
  paging?: OpdsPaging;
  /** Full path+query for the next page, emitted as a `next` link when present. */
  nextPath?: string;
}

/** The assembled OPDS 2 feed shape. */
export interface OpdsFeed {
  metadata: Record<string, unknown>;
  links: OpdsFeedLink[];
  publications?: OpdsPublication[];
}

/** Assemble an OPDS 2 feed object from its parts. */
export function buildOpdsFeed(input: OpdsFeedInput): OpdsFeed {
  const links: OpdsFeedLink[] = [
    { rel: 'self', href: `${input.baseUrl}${input.selfPath}`, type: OPDS_MIME },
    ...(input.links ?? []),
  ];
  if (input.nextPath) {
    links.push({ rel: 'next', href: `${input.baseUrl}${input.nextPath}`, type: OPDS_MIME });
  }

  const metadata: Record<string, unknown> = { title: input.title };
  if (input.numberOfItems != null) metadata.numberOfItems = input.numberOfItems;
  if (input.paging) {
    metadata.itemsPerPage = input.paging.limit;
    metadata.currentPage = input.paging.page;
  }

  const feed: OpdsFeed = { metadata, links };
  if (input.publications) feed.publications = input.publications;
  return feed;
}

/**
 * The OpenSearch description document advertising the OPDS search endpoint.
 * OPDS 2 clients discover it via the root feed's `search` link, then issue
 * `GET /api/opds/search?q={searchTerms}`.
 */
export function buildOpenSearchDescription(baseUrl: string): string {
  const template = `${baseUrl}/api/opds/search?q={searchTerms}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>CB8</ShortName>
  <Description>Search the CB8 comic and book library</Description>
  <Url type="${OPDS_MIME}" template="${template}"/>
</OpenSearchDescription>
`;
}
