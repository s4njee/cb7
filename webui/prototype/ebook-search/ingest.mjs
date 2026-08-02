import { extractEpub } from './epub.mjs';
import { chunk, embed } from './embed.mjs';
import { pool, ensureSchema, toVector } from './db.mjs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node ingest.mjs <file.epub>');
  process.exit(1);
}

await ensureSchema();
const { title, sections } = await extractEpub(path);
console.log(`Ingesting "${title}" — ${sections.length} sections`);

let total = 0;
for (const sec of sections) {
  const chunks = chunk(sec.text);
  if (!chunks.length) continue;
  const vecs = await embed(chunks);
  for (let i = 0; i < chunks.length; i++) {
    await pool.query(
      'INSERT INTO ebook_chunks (book, chapter, idx, content, embedding) VALUES ($1,$2,$3,$4,$5)',
      [title, sec.title, total, chunks[i], toVector(vecs[i])]
    );
    total++;
  }
  process.stdout.write(`  · ${sec.title}: ${chunks.length} chunks\n`);
}

console.log(`Done — embedded ${total} chunks for "${title}".`);
await pool.end();
