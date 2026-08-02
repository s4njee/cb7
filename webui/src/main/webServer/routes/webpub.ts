import * as path from 'node:path';
import { sendJson, sendError } from '../middleware';
import { requestBaseUrl } from '../serverHelpers';
import { type RouteHandler } from '../context';
import { withArchive } from '../archiveCache';
import { pageMimeForFilename } from './comicRouteHelpers';

export const handle: RouteHandler = async (ctx) => {
  const { req, res, db, pathname, method, query, currentUser } = ctx;

  // 1. WebPub manifest endpoint
  // GET /api/comics/:id/manifest
  const manifestMatch = pathname.match(/^\/api\/comics\/(\d+)\/manifest$/);
  if (method === 'GET' && manifestMatch) {
    const id = parseInt(manifestMatch[1], 10);
    const record = await db.getComicLite(id);
    if (!record) {
      sendError(res, 404, 'Comic not found');
      return true;
    }

    const baseUrl = requestBaseUrl(
      req.headers.host,
      req.headers['x-forwarded-host'],
      req.headers['x-forwarded-proto'],
    );
    const ext = path.extname(record.filePath).toLowerCase();

    let readingOrder: any[] = [];
    if (record.mediaType === 'comic') {
      const upscale = req.headers['x-cb8-upscale'] === 'true';
      const qs = upscale ? '?upscale=1' : '';
      try {
        await withArchive(id, record.filePath, async (handle) => {
          readingOrder = handle.entries.map((entry, index) => {
            const mime = pageMimeForFilename(entry.filename);
            return {
              href: `${baseUrl}/api/comics/${id}/pages/${index}${qs}`,
              type: mime,
            };
          });
        });
      } catch (err) {
        // fallback to database page count if archive opening fails
        const count = record.pageCount || 0;
        for (let i = 0; i < count; i++) {
          readingOrder.push({
            href: `${baseUrl}/api/comics/${id}/pages/${i}${qs}`,
            type: 'image/jpeg',
          });
        }
      }
    } else {
      // PDF or EPUB book
      const mime = ext === '.pdf' ? 'application/pdf' : 'application/epub+zip';
      readingOrder.push({
        href: `${baseUrl}/api/comics/${id}/file`,
        type: mime,
      });
    }

    const manifest = {
      "@context": "https://readium.org/context.jsonld",
      "metadata": {
        "@type": record.mediaType === 'comic' ? "http://schema.org/ComicStory" : "http://schema.org/EBook",
        "title": record.title,
        "numberOfPages": readingOrder.length,
        "conformsTo": record.mediaType === 'comic' 
          ? "https://readium.org/webpub-manifest/profiles/comic"
          : (ext === '.pdf' ? "https://readium.org/webpub-manifest/profiles/pdf" : "https://readium.org/webpub-manifest/profiles/epub")
      },
      "links": [
        {
          "rel": "self",
          "href": `${baseUrl}/api/comics/${id}/manifest`,
          "type": "application/webpub+json"
        },
        {
          "rel": "cover",
          "href": `${baseUrl}/api/comics/${id}/thumbnail`,
          "type": "image/jpeg"
        }
      ],
      "readingOrder": readingOrder,
    };

    sendJson(res, 200, manifest, 'application/webpub+json');
    return true;
  }


  return false;
};
