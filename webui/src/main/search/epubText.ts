import yauzl from 'yauzl';

/**
 * @module
 * Minimal server-side EPUB text extraction for the search index. Reads the zip,
 * follows the OPF spine for reading order, and strips each XHTML section to
 * plain text. Good enough for indexing; not a full EPUB parser.
 */

export interface EpubSection {
  chapter: string | null;
  text: string;
}

/** Read every zip entry into memory (EPUBs are small). */
function readZip(path: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('open failed'));
      const files = new Map<string, Buffer>();
      zip.on('error', reject);
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('read failed'));
          const bufs: Buffer[] = [];
          stream.on('data', (d: Buffer) => bufs.push(d));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(bufs));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(files));
      zip.readEntry();
    });
  });
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

function join(dir: string, href: string): string {
  const out: string[] = [];
  for (const part of (dir + href.replace(/^\.\//, '')).split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.') out.push(part);
  }
  return out.join('/');
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*\/?\s*(p|div|h[1-6]|li|br|section|article)[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#?[a-z0-9]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chapterTitle(html: string, fallback: string): string {
  const m = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (m && htmlToText(m[1]).slice(0, 80)) || fallback;
}

/** Extract `{ title, sections }` from an EPUB file in spine (reading) order. */
export async function extractEpubText(path: string): Promise<{ title: string; sections: EpubSection[] }> {
  const files = await readZip(path);
  const container = files.get('META-INF/container.xml')?.toString('utf8') ?? '';
  const opfPath = container.match(/full-path="([^"]+)"/i)?.[1];
  if (!opfPath) throw new Error('EPUB has no OPF');
  const opf = files.get(opfPath)?.toString('utf8') ?? '';
  const opfDir = dirOf(opfPath);

  const title = htmlToText(opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] ?? '') || opfPath;

  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = m[0].match(/\bid="([^"]+)"/i)?.[1];
    const href = m[0].match(/\bhref="([^"]+)"/i)?.[1];
    const type = m[0].match(/\bmedia-type="([^"]+)"/i)?.[1] ?? '';
    if (id && href && /xhtml|html/.test(type)) manifest.set(id, href);
  }

  const sections: EpubSection[] = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/gi)) {
    const href = manifest.get(m[1]);
    if (!href) continue;
    const html = files.get(join(opfDir, href))?.toString('utf8');
    if (!html) continue;
    const text = htmlToText(html);
    if (text.length < 40) continue; // skip covers / nav / empties
    sections.push({ chapter: chapterTitle(html, href.split('/').pop() ?? href), text });
  }
  return { title, sections };
}
