import * as path from 'node:path';
import * as yauzl from 'yauzl';

/**
 * @module
 * Extract Cover Image and Spine Length From EPUB Files
 *
 * Architecture overview for Junior Devs:
 * An EPUB is really a zip file containing XHTML, CSS, and images plus an XML
 * manifest (the "OPF") describing the book. To show a thumbnail and a page count
 * we need two things from it: the cover image and the number of reading sections
 * (the "spine"). This module opens the zip with `yauzl`, does just enough XML
 * parsing by hand (no heavyweight EPUB library) to find the cover and count the
 * spine, and returns them. It is used by the ingest pipeline.
 */

interface ZipEntryMap {
  zipFile: yauzl.ZipFile;
  entries: Map<string, yauzl.Entry>;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(attrPattern)) {
    attrs[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function normalizeZipPath(value: string): string {
  return value.replace(/^\/+/, '').replace(/\\/g, '/');
}

function resolveOpfHref(opfPath: string, href: string): string {
  const baseDir = path.posix.dirname(normalizeZipPath(opfPath));
  const joined = baseDir === '.' ? href : path.posix.join(baseDir, href);
  return normalizeZipPath(joined);
}

function openZip(filePath: string): Promise<ZipEntryMap> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipFile) => {
      if (err) {
        reject(err);
        return;
      }
      if (!zipFile) {
        reject(new Error(`Failed to open EPUB: ${filePath}`));
        return;
      }

      const entries = new Map<string, yauzl.Entry>();
      zipFile.on('entry', (entry) => {
        if (!entry.fileName.endsWith('/')) {
          entries.set(normalizeZipPath(entry.fileName), entry);
        }
        zipFile.readEntry();
      });
      zipFile.on('end', () => resolve({ zipFile, entries }));
      zipFile.on('error', reject);
      zipFile.readEntry();
    });
  });
}

function readZipEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      if (!stream) {
        reject(new Error(`Failed to read EPUB entry: ${entry.fileName}`));
        return;
      }

      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

function findOpfPath(containerXml: string): string | null {
  for (const match of containerXml.matchAll(/<rootfile\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    if (attrs['full-path']) return normalizeZipPath(attrs['full-path']);
  }
  return null;
}

function findCoverHref(opfXml: string): string | null {
  let coverId: string | null = null;
  for (const match of opfXml.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    if (attrs.name?.toLowerCase() === 'cover' && attrs.content) {
      coverId = attrs.content;
      break;
    }
  }

  const manifestItems = Array.from(opfXml.matchAll(/<item\b[^>]*>/gi)).map((match) => parseAttributes(match[0]));
  const byCoverId = coverId ? manifestItems.find((item) => item.id === coverId && item.href) : undefined;
  if (byCoverId?.href) return byCoverId.href;

  const byProperty = manifestItems.find((item) =>
    item.href &&
    item['media-type']?.startsWith('image/') &&
    item.properties?.split(/\s+/).includes('cover-image')
  );
  if (byProperty?.href) return byProperty.href;

  const byName = manifestItems.find((item) =>
    item.href &&
    item['media-type']?.startsWith('image/') &&
    `${item.id ?? ''} ${item.href}`.toLowerCase().includes('cover')
  );
  if (byName?.href) return byName.href;

  return null;
}

function countSpineItems(opfXml: string): number {
  // Match the <spine> element and count its <itemref> children.
  const spineMatch = opfXml.match(/<spine\b[^>]*>([\s\S]*?)<\/spine>/i);
  if (!spineMatch) return 0;
  return (spineMatch[1].match(/<itemref\b/gi) ?? []).length;
}

/**
 * Extract the cover image from an EPUB file.
 * Walks container.xml -> OPF manifest -> cover href, then reads that
 * image out of the zip. Always closes the zip handle.
 * @param filePath Absolute path to the .epub file.
 * @returns The cover image bytes, or `null` if no cover can be found.
 */
export async function extractEpubCover(filePath: string): Promise<Buffer | null> {
  const { zipFile, entries } = await openZip(filePath);
  try {
    const containerEntry = entries.get('META-INF/container.xml');
    if (!containerEntry) return null;

    const containerXml = (await readZipEntry(zipFile, containerEntry)).toString('utf8');
    const opfPath = findOpfPath(containerXml);
    if (!opfPath) return null;

    const opfEntry = entries.get(opfPath);
    if (!opfEntry) return null;

    const opfXml = (await readZipEntry(zipFile, opfEntry)).toString('utf8');
    const coverHref = findCoverHref(opfXml);
    if (!coverHref) return null;

    const coverPath = resolveOpfHref(opfPath, coverHref);
    const coverEntry = entries.get(coverPath);
    if (!coverEntry) return null;

    return readZipEntry(zipFile, coverEntry);
  } finally {
    zipFile.close();
  }
}

/**
 * Count the spine documents (reading sections) in an EPUB.
 * @param filePath Absolute path to the .epub file.
 * @returns The number of `<itemref>` entries in the spine (used as a page count).
 */
export async function getEpubSpineCount(filePath: string): Promise<number> {
  const { zipFile, entries } = await openZip(filePath);
  try {
    const containerEntry = entries.get('META-INF/container.xml');
    if (!containerEntry) return 0;
    const containerXml = (await readZipEntry(zipFile, containerEntry)).toString('utf8');
    const opfPath = findOpfPath(containerXml);
    if (!opfPath) return 0;
    const opfEntry = entries.get(opfPath);
    if (!opfEntry) return 0;
    const opfXml = (await readZipEntry(zipFile, opfEntry)).toString('utf8');
    return countSpineItems(opfXml);
  } finally {
    zipFile.close();
  }
}
