#!/usr/bin/env node
/**
 * bench-search.mjs — generate a synthetic CB8 library and time the search +
 * sort paths against it.
 *
 * Usage:
 *   node scripts/bench-search.mjs            # 100,000 rows, default queries
 *   node scripts/bench-search.mjs --rows 50000 --runs 5
 *
 * The benchmark exercises the same SQL the app uses (LIKE pre-FTS vs FTS5
 * post-migration) so improvements show up directly in numbers, not vibes.
 */

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, arr) => {
    if (a.startsWith('--')) pairs.push([a.slice(2), arr[i + 1]]);
    return pairs;
  }, []),
);
const ROWS = Number(args.rows ?? 100_000);
const RUNS = Number(args.runs ?? 3);

const tmp = mkdtempSync(join(tmpdir(), 'cb8-bench-'));
const dbPath = join(tmp, 'bench.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

console.log(`[bench] ${ROWS} rows, ${RUNS} runs each — db at ${dbPath}`);

// Minimal schema mirroring the columns the search hits.
db.exec(`
  CREATE TABLE comics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0,
    file_size INTEGER NOT NULL DEFAULT 0,
    cover_thumbnail BLOB,
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    last_page INTEGER, last_location TEXT, last_read TEXT,
    media_type TEXT NOT NULL DEFAULT 'comic',
    series_name TEXT, volume_number REAL, chapter_number REAL,
    completed INTEGER NOT NULL DEFAULT 0,
    author TEXT, artist TEXT, genre TEXT, year INTEGER, summary TEXT
  );
  CREATE INDEX idx_media_title ON comics(media_type, title COLLATE NOCASE);
  CREATE VIRTUAL TABLE comics_fts USING fts5(
    title, file_path, series_name, author, summary,
    content='comics', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
  );
`);

const SERIES = ['Naruto', 'Bleach', 'One Piece', 'Berserk', 'Vinland Saga', 'Watchmen', 'Sandman', 'Saga', 'Akira', 'Monster'];
const ADJ = ['Crimson', 'Silent', 'Forgotten', 'Distant', 'Azure', 'Hollow', 'Burning', 'Last', 'Hidden', 'Broken'];
const NOUN = ['Star', 'Tide', 'Garden', 'Mountain', 'Echo', 'Storm', 'Throne', 'Promise', 'Empire', 'Whisper'];

function randomTitle(i) {
  const inSeries = i % 3 === 0;
  if (inSeries) {
    const s = SERIES[i % SERIES.length];
    return `${s} Vol. ${(i % 60) + 1}`;
  }
  return `${ADJ[i % ADJ.length]} ${NOUN[(i * 7) % NOUN.length]} ${i}`;
}

console.log('[bench] inserting…');
const insert = db.prepare(`
  INSERT INTO comics (file_path, title, page_count, file_size, media_type, series_name, author, summary)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const tx = db.transaction((n) => {
  for (let i = 0; i < n; i++) {
    const title = randomTitle(i);
    insert.run(
      `/library/manga/${i % 50}/${title.replace(/\W+/g, '_')}_${i}.cbz`,
      title,
      Math.floor(Math.random() * 220) + 20,
      Math.floor(Math.random() * 100_000_000),
      Math.random() > 0.7 ? 'book' : 'comic',
      i % 3 === 0 ? SERIES[i % SERIES.length] : null,
      i % 5 === 0 ? `Author ${i % 200}` : null,
      `Synopsis blob describing volume ${i}.`,
    );
  }
});
const insStart = Date.now();
tx(ROWS);
console.log(`[bench] inserted ${ROWS} rows in ${Date.now() - insStart}ms`);

// Backfill FTS the same way the migration does.
const ftsStart = Date.now();
db.exec(`INSERT INTO comics_fts(comics_fts) VALUES ('rebuild')`);
console.log(`[bench] FTS rebuild: ${Date.now() - ftsStart}ms`);

// Prepare the two query shapes.
const likeStmt = db.prepare(`
  SELECT id, title FROM comics
  WHERE (title LIKE ? COLLATE NOCASE OR file_path LIKE ? COLLATE NOCASE)
  ORDER BY title COLLATE NOCASE LIMIT 50
`);
const ftsStmt = db.prepare(`
  SELECT c.id, c.title FROM comics c
  WHERE c.id IN (SELECT rowid FROM comics_fts WHERE comics_fts MATCH ?)
  ORDER BY c.title COLLATE NOCASE LIMIT 50
`);

const cases = [
  { label: 'rare token', term: 'naruto' },
  { label: 'common adj', term: 'Crimson' },
  { label: 'two-word', term: 'Silent Tide' },
  { label: 'short prefix', term: 'be' },
];

function bench(label, fn) {
  const samples = [];
  // Warm-up
  fn();
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(`  ${label.padEnd(28)} mean=${mean.toFixed(2)}ms  min=${min.toFixed(2)}  max=${max.toFixed(2)}`);
}

console.log('[bench] LIKE %term%:');
for (const c of cases) {
  bench(c.label + ` ("${c.term}")`, () => likeStmt.all(`%${c.term}%`, `%${c.term}%`));
}

console.log('[bench] FTS5 MATCH:');
for (const c of cases) {
  const fts = c.term.split(/\s+/).map((t) => `${t.replace(/[^\w]/g, '')}*`).join(' ');
  bench(c.label + ` ("${fts}")`, () => ftsStmt.all(fts));
}

db.close();
rmSync(tmp, { recursive: true, force: true });
