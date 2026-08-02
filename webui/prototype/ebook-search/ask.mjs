import { embed } from './embed.mjs';
import { pool, toVector } from './db.mjs';

// RAG: hybrid-retrieve the most relevant passages, then have Claude answer using
// ONLY those passages, with inline [n] citations. Runs when ANTHROPIC_API_KEY is
// set; in production the LLM could equally be a local model on the 3090.

const question = process.argv.slice(2).join(' ');
if (!question) {
  console.error('usage: node ask.mjs <question>');
  process.exit(1);
}
const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Set ANTHROPIC_API_KEY to generate an answer (retrieval works without it — see query.mjs).');
  process.exit(1);
}
const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// --- retrieve (same hybrid RRF as query.mjs) ---
const [qvec] = await embed([question]);
const vec = toVector(qvec);
const N = 20, K = 60;
const kw = (await pool.query(
  `SELECT id, book, chapter, content FROM ebook_chunks
    WHERE tsv @@ plainto_tsquery('english',$1)
    ORDER BY ts_rank(tsv, plainto_tsquery('english',$1)) DESC LIMIT $2`, [question, N])).rows;
const sem = (await pool.query(
  `SELECT id, book, chapter, content FROM ebook_chunks
    ORDER BY embedding <=> $1::vector LIMIT $2`, [vec, N])).rows;
const score = new Map(), meta = new Map();
for (const arm of [kw, sem]) arm.forEach((r, i) => {
  score.set(r.id, (score.get(r.id) || 0) + 1 / (K + i + 1));
  meta.set(r.id, r);
});
const top = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => meta.get(id));

// --- generate ---
const context = top.map((r, i) => `[${i + 1}] ${r.book} — ${r.chapter || ''}\n${r.content}`).join('\n\n');
const system =
  'You answer questions about a personal e-book library using ONLY the provided passages. ' +
  'Cite the passages you use inline as [n]. If the passages do not contain the answer, say so plainly. Be concise.';

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  body: JSON.stringify({
    model,
    max_tokens: 600,
    system,
    messages: [{ role: 'user', content: `Passages:\n\n${context}\n\nQuestion: ${question}` }],
  }),
});
if (!res.ok) {
  console.error(`Claude error ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const json = await res.json();
const answer = (json.content || []).map((c) => c.text || '').join('');

console.log(`\nQ: ${question}\n`);
console.log(`${answer}\n`);
console.log('Retrieved from:');
top.forEach((r, i) => console.log(`  [${i + 1}] ${r.book} — ${r.chapter || ''}`));
await pool.end();
