import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { close, openCbz, readArchiveEntry } from './archiveLoader';
import {
  parseComicInfoJson,
  parseComicInfoXml,
  readComicInfoFromArchive,
  resolveIngestMetadata,
} from './embeddedMetadata';
import { extractEpubMetadata } from './epubCoverExtractor';

// ---------------------------------------------------------------------------
// Minimal in-memory ZIP builder (stored, uncompressed entries)
//
// We hand-roll just enough of the ZIP container format to feed the yauzl-based
// archive/epub readers real files, without adding a zip-writer dependency.
// ---------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable![(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed (2.0)
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central directory signature
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(0, 10); // method
    cd.writeUInt16LE(0, 12); // mod time
    cd.writeUInt16LE(0x21, 14); // mod date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra field length
    cd.writeUInt16LE(0, 32); // comment length
    cd.writeUInt16LE(0, 34); // disk number start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }

  const cdStart = offset;
  const cdData = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // cd disk number
  eocd.writeUInt16LE(files.length, 8); // entries on this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(cdData.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([...chunks, cdData, eocd]);
}

// ---------------------------------------------------------------------------
// Fixture helpers (real temp files for the yauzl-backed readers)
// ---------------------------------------------------------------------------

let tempRoot: string;

async function writeFixture(relativePath: string, data: Buffer | string): Promise<string> {
  const fullPath = path.join(tempRoot, relativePath);
  await fsp.mkdir(path.dirname(fullPath), { recursive: true });
  await fsp.writeFile(fullPath, data);
  return fullPath;
}

const FAKE_PAGE = Buffer.from('fake image bytes');

// ---------------------------------------------------------------------------

describe('parseComicInfoXml', () => {
  it('maps the full ComicRack tag set', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ComicInfo>
  <Title>Saga</Title>
  <Series>Test Series</Series>
  <Volume>3</Volume>
  <Number>27</Number>
  <Writer>Brian K. Vaughan</Writer>
  <Penciller>Fiona Staples</Penciller>
  <Genre>Science Fiction</Genre>
  <Year>2016</Year>
  <Summary>A   multi-line
      summary text.</Summary>
  <Language>en</Language>
  <Publisher>Image Comics</Publisher>
</ComicInfo>`;
    expect(parseComicInfoXml(xml)).toEqual({
      title: 'Saga',
      seriesName: 'Test Series',
      volumeNumber: 3,
      chapterNumber: 27,
      author: 'Brian K. Vaughan',
      artist: 'Fiona Staples',
      genre: 'Science Fiction',
      year: 2016,
      summary: 'A multi-line summary text.',
      language: 'en',
      publisher: 'Image Comics',
    });
  });

  it('omits fields for missing tags', () => {
    expect(parseComicInfoXml('<ComicInfo><Title>Only Title</Title></ComicInfo>')).toEqual({
      title: 'Only Title',
    });
  });

  it('omits tags whose text is empty after trimming', () => {
    expect(parseComicInfoXml('<ComicInfo><Title>   </Title><Series></Series></ComicInfo>')).toEqual({});
  });

  it('ignores PageCount (the archive entry count is authoritative)', () => {
    expect(
      parseComicInfoXml('<ComicInfo><Title>X</Title><PageCount>120</PageCount></ComicInfo>'),
    ).toEqual({ title: 'X' });
  });

  it('decodes XML entities in text', () => {
    expect(
      parseComicInfoXml('<ComicInfo><Title>Battles &amp; Bows &lt;Vol. 1&gt;</Title></ComicInfo>'),
    ).toEqual({ title: 'Battles & Bows <Vol. 1>' });
  });

  it('matches tags case-insensitively', () => {
    expect(
      parseComicInfoXml('<comicinfo><title>Lower Title</title><SERIES>Lower Series</SERIES></comicinfo>'),
    ).toEqual({ title: 'Lower Title', seriesName: 'Lower Series' });
  });
});

describe('parseComicInfoJson', () => {
  it('maps camelCase keys with mixed number/string values', () => {
    const json = JSON.stringify({
      Title: 'Saga',
      Series: 'Test Series',
      Volume: 3,
      Number: '27',
      Writer: 'Brian K. Vaughan',
      Penciller: 'Fiona Staples',
      Genre: 'Science Fiction',
      Year: 2016,
      Summary: 'A summary.',
      Language: 'en',
      Publisher: 'Image Comics',
    });
    expect(parseComicInfoJson(json)).toEqual({
      title: 'Saga',
      seriesName: 'Test Series',
      volumeNumber: 3,
      chapterNumber: 27,
      author: 'Brian K. Vaughan',
      artist: 'Fiona Staples',
      genre: 'Science Fiction',
      year: 2016,
      summary: 'A summary.',
      language: 'en',
      publisher: 'Image Comics',
    });
  });

  it('accepts lowercase keys', () => {
    const json = JSON.stringify({
      title: 'Lower',
      series: 'S2',
      volume: '2',
      number: 5,
      writer: 'W',
      penciller: 'P',
      genre: 'G',
      year: '2015',
      summary: 'Sum',
      language: 'fr',
      publisher: 'Pub',
    });
    expect(parseComicInfoJson(json)).toEqual({
      title: 'Lower',
      seriesName: 'S2',
      volumeNumber: 2,
      chapterNumber: 5,
      author: 'W',
      artist: 'P',
      genre: 'G',
      year: 2015,
      summary: 'Sum',
      language: 'fr',
      publisher: 'Pub',
    });
  });

  it('omits empty values and ignores invalid JSON', () => {
    expect(parseComicInfoJson('{"Title":"   ","Series":"","Genre":null}')).toEqual({});
    expect(parseComicInfoJson('not json')).toEqual({});
    expect(parseComicInfoJson('42')).toEqual({});
  });
});

describe('resolveIngestMetadata', () => {
  const emptySeries = { seriesName: null, volumeNumber: null, chapterNumber: null };

  it('prefers the embedded title over the filename', () => {
    const resolved = resolveIngestMetadata('Filename.cbz', emptySeries, { title: 'File Title' });
    expect(resolved.title).toBe('File Title');
  });

  it('lets embedded series/volume/chapter beat the filename SeriesInfo', () => {
    const resolved = resolveIngestMetadata(
      'F.cbz',
      { seriesName: 'From Filename', volumeNumber: 9, chapterNumber: 9 },
      { seriesName: 'Embedded', volumeNumber: 1, chapterNumber: 2 },
    );
    expect(resolved).toMatchObject({
      seriesName: 'Embedded',
      volumeNumber: 1,
      chapterNumber: 2,
    });
  });

  it('passes filename values through when embedded metadata is absent', () => {
    expect(resolveIngestMetadata('F.cbz', { seriesName: 'From Filename', volumeNumber: 5, chapterNumber: null }, null)).toEqual({
      title: 'F.cbz',
      seriesName: 'From Filename',
      volumeNumber: 5,
      chapterNumber: null,
      author: null,
      artist: null,
      genre: null,
      year: null,
      summary: null,
      language: null,
      publisher: null,
      tags: [],
    });
  });

  it('keeps author/genre/etc. null and tags empty when embedded has only a title', () => {
    const resolved = resolveIngestMetadata('F.cbz', emptySeries, { title: 'Only Title' });
    expect(resolved).toMatchObject({
      author: null,
      artist: null,
      genre: null,
      year: null,
      summary: null,
      language: null,
      publisher: null,
      tags: [],
    });
  });
});

describe('readComicInfoFromArchive / readArchiveEntry (CBZ)', () => {
  beforeEach(async () => {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cb8-embedded-meta-'));
  });

  afterEach(async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });

  it('parses ComicInfo.xml out of a CBZ archive', async () => {
    const filePath = await writeFixture(
      'with-meta.cbz',
      buildZip([
        { name: 'ComicInfo.xml', data: Buffer.from('<ComicInfo><Title>Saga</Title><Number>27</Number></ComicInfo>') },
        { name: 'page 01.jpg', data: FAKE_PAGE },
      ]),
    );
    const handle = await openCbz(filePath);
    try {
      expect(await readComicInfoFromArchive(handle)).toEqual({ title: 'Saga', chapterNumber: 27 });
    } finally {
      await close(handle);
    }
  });

  it('matches the metadata file by case-insensitive basename', async () => {
    const filePath = await writeFixture(
      'mixed-case.cbz',
      buildZip([
        { name: 'ComicInfo.Xml', data: Buffer.from('<ComicInfo><Title>Mixed</Title></ComicInfo>') },
        { name: 'page 01.jpg', data: FAKE_PAGE },
      ]),
    );
    const handle = await openCbz(filePath);
    try {
      const buf = await readArchiveEntry(handle, 'comicinfo.xml');
      expect(buf?.toString('utf8')).toContain('<Title>Mixed</Title>');
      expect(await readComicInfoFromArchive(handle)).toEqual({ title: 'Mixed' });
    } finally {
      await close(handle);
    }
  });

  it('returns null when the archive has no metadata file', async () => {
    const filePath = await writeFixture(
      'no-meta.cbz',
      buildZip([{ name: 'page 01.jpg', data: FAKE_PAGE }]),
    );
    const handle = await openCbz(filePath);
    try {
      expect(await readComicInfoFromArchive(handle)).toBeNull();
      expect(await readArchiveEntry(handle, 'ComicInfo.xml')).toBeNull();
    } finally {
      await close(handle);
    }
  });
});

describe('extractEpubMetadata', () => {
  const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  beforeEach(async () => {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cb8-embedded-epub-'));
  });

  afterEach(async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });

  it('parses Dublin Core + calibre metadata from the OPF', async () => {
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">
  <metadata>
    <dc:title>Embedded Book Title</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:date>2019-05-06</dc:date>
    <dc:description><p>A multi-word summary with a <b>bold</b> word.</p></dc:description>
    <dc:subject>Fantasy;Drama</dc:subject>
    <dc:subject> Science Fiction , Space Opera </dc:subject>
    <dc:publisher>Test Publisher</dc:publisher>
    <meta name="calibre:series" content="Test Series"/>
    <meta name="calibre:series_index" content="2.5"/>
  </metadata>
  <manifest/>
  <spine/>
</package>`;
    const filePath = await writeFixture(
      'book.epub',
      buildZip([
        { name: 'META-INF/container.xml', data: Buffer.from(CONTAINER) },
        { name: 'OEBPS/content.opf', data: Buffer.from(opf) },
        { name: 'OEBPS/page1.xhtml', data: Buffer.from('<html><body><p>page</p></body></html>') },
      ]),
    );
    expect(await extractEpubMetadata(filePath)).toEqual({
      title: 'Embedded Book Title',
      author: 'Test Author',
      language: 'en',
      year: 2019,
      summary: 'A multi-word summary with a bold word.',
      tags: ['Fantasy', 'Drama', 'Science Fiction', 'Space Opera'],
      publisher: 'Test Publisher',
      seriesName: 'Test Series',
      volumeNumber: 2.5,
    });
  });

  it('returns null when the OPF cannot be found', async () => {
    const filePath = await writeFixture(
      'no-opf.epub',
      buildZip([{ name: 'META-INF/container.xml', data: Buffer.from(CONTAINER) }]),
    );
    expect(await extractEpubMetadata(filePath)).toBeNull();
  });
});
