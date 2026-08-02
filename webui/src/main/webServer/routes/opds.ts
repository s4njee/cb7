import { sendJson } from '../middleware';
import { requestBaseUrl } from '../serverHelpers';
import { type RouteHandler } from '../context';

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, currentUser } = ctx;

  // OPDS 2.0 Catalog Feed
  // GET /api/opds
  if (method === 'GET' && pathname === '/api/opds') {
    const baseUrl = requestBaseUrl(
      req.headers.host,
      req.headers['x-forwarded-host'],
      req.headers['x-forwarded-proto'],
    );

    // Query all comics/books from database
    const result = await db.queryComicsForUser(currentUser?.id ?? null, {
      limit: 1000,
      offset: 0,
    });

    const publications = result.records.map((record) => {
      return {
        "metadata": {
          "@type": record.mediaType === 'comic' ? "http://schema.org/ComicStory" : "http://schema.org/EBook",
          "title": record.title,
          "identifier": `cb8:comic:${record.id}`,
        },
        "links": [
          {
            "rel": "self",
            "href": `${baseUrl}/api/comics/${record.id}/manifest`,
            "type": "application/webpub+json"
          },
          {
            "rel": "cover",
            "href": `${baseUrl}/api/comics/${record.id}/thumbnail`,
            "type": "image/jpeg"
          }
        ]
      };
    });

    const feed = {
      "metadata": {
        "title": "CB8 Library Feed"
      },
      "links": [
        {
          "rel": "self",
          "href": `${baseUrl}/api/opds`,
          "type": "application/opds+json"
        }
      ],
      "publications": publications
    };

    sendJson(res, 200, feed, 'application/opds+json');
    return true;
  }

  return false;
};
