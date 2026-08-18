import { embed } from './embed.mjs';
import { pool, toVector } from './db.mjs';

const q = process.argv.slice(2).join(' ');
if (!q) {
  console.error('usage: node query.mjs <question>');
  process.exit(1);
}

const [qvec] = await embed([q]);
const vec = toVector(qvec);

const N = 30; // candidates per arm
const K = 60; // RRF damping constant

// Keyword arm (Postgres FTS) and semantic arm (pgvector cosine).
const kw = (
  await pool.query(
    `SELECT id, book, chapter, content
       FROM ebook_chunks
      WHERE tsv @@ plainto_tsquery('english', $1)
      ORDER BY ts_rank(tsv, plainto_tsquery('english', $1)) DESC
      LIMIT $2`,
    [q, N]
  )
).rows;
const sem = (
  await pool.query(
    `SELECT id, book, chapter, content
       FROM ebook_chunks
      ORDER BY embedding <=> $1::vector
      LIMIT $2`,
    [vec, N]
  )
).rows;

// Reciprocal Rank Fusion: a hit's score is the sum of 1/(K+rank) across arms,
// so things ranked highly by either keyword OR meaning float up, and things in
// both rise highest.
const score = new Map();
const meta = new Map();
const inKw = new Set(kw.map((r) => r.id));
const inSem = new Set(sem.map((r) => r.id));
for (const arm of [kw, sem]) {
  arm.forEach((r, i) => {
    score.set(r.id, (score.get(r.id) || 0) + 1 / (K + i + 1));
    meta.set(r.id, r);
  });
}
const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

console.log(`\nQuery: "${q}"   (keyword hits: ${kw.length}, semantic candidates: ${sem.length})\n`);
for (const [id, s] of ranked) {
  const r = meta.get(id);
  const via = inKw.has(id) && inSem.has(id) ? 'kw+sem' : inKw.has(id) ? 'kw' : 'sem';
  const snippet = r.content.replace(/\s+/g, ' ').slice(0, 160);
  console.log(`• ${r.book} — ${r.chapter || ''}   [${via}  rrf=${s.toFixed(4)}]`);
  console.log(`    …${snippet}…\n`);
}
await pool.end();
