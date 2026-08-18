import yauzl from 'yauzl';

// Read every zip entry into a Map<name, Buffer>. EPUBs are small enough to hold
// in memory; a real version would stream.
function readZip(path) {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const files = new Map();
      zip.on('error', reject);
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const bufs = [];
          stream.on('data', (d) => bufs.push(d));
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

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const join = (dir, href) => {
  const parts = (dir + href.replace(/^\.\//, '')).split('/');
  const out = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part !== '.') out.push(part);
  }
  return out.join('/');
};

function htmlToText(html) {
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

function chapterTitle(html, fallback) {
  const m =
    html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i) ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = m && htmlToText(m[1]).slice(0, 80);
  return t || fallback;
}

/** Extract { title, sections:[{title,text}] } from an EPUB in spine order. */
export async function extractEpub(path) {
  const files = readZipToMaps(await readZip(path));
  return files;
}

function readZipToMaps(files) {
  const container = files.get('META-INF/container.xml')?.toString('utf8') || '';
  const opfPath = container.match(/full-path="([^"]+)"/i)?.[1];
  if (!opfPath) throw new Error('No OPF found in EPUB');
  const opf = files.get(opfPath)?.toString('utf8') || '';
  const opfDir = dirOf(opfPath);

  const bookTitle =
    htmlToText(opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] || '') ||
    opfPath;

  // manifest: id -> href (xhtml only)
  const manifest = new Map();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = m[0];
    const id = tag.match(/\bid="([^"]+)"/i)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/i)?.[1];
    const type = tag.match(/\bmedia-type="([^"]+)"/i)?.[1] || '';
    if (id && href && /xhtml|html/.test(type)) manifest.set(id, href);
  }

  // spine: ordered idrefs
  const sections = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/gi)) {
    const href = manifest.get(m[1]);
    if (!href) continue;
    const name = join(opfDir, href);
    const html = files.get(name)?.toString('utf8');
    if (!html) continue;
    const text = htmlToText(html);
    if (text.length < 40) continue; // skip covers / nav / empties
    sections.push({ title: chapterTitle(html, href.split('/').pop()), text });
  }
  return { title: bookTitle, sections };
}
