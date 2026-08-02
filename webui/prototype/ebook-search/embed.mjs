// Pluggable embedding backend.
//
//   EMBED_BACKEND=minilm   (default) — local transformers.js, all-MiniLM-L6-v2, 384-d.
//                                       Zero setup; for testing.
//   EMBED_BACKEND=http     — call an OpenAI-compatible /v1/embeddings endpoint.
//                            This is the production path: a GPU embedding server
//                            (HF TEI / Infinity / vLLM) on the 3090 box. Set
//                            EMBED_URL, EMBED_MODEL, EMBED_DIM (+ EMBED_KEY if it
//                            needs auth).
//
// Switching models changes the vector dimension, so set EMBED_DIM to match and
// re-create the table (drop + re-ingest).

const BACKEND = process.env.EMBED_BACKEND || 'minilm';

export const EMBED_DIM = Number(
  process.env.EMBED_DIM || (BACKEND === 'minilm' ? 384 : 1024)
);

// --- local: all-MiniLM-L6-v2 via transformers.js (lazy so the http path never
//     pulls in onnxruntime) ---
let extractor;
async function embedMiniLM(texts) {
  if (!extractor) {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = new URL('./.models/', import.meta.url).pathname;
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  const out = [];
  for (const t of texts) {
    const r = await extractor(t, { pooling: 'mean', normalize: true });
    out.push(Array.from(r.data));
  }
  return out;
}

// --- production: OpenAI-compatible embeddings endpoint (the 3090 GPU server) ---
async function embedHttp(texts) {
  const url = process.env.EMBED_URL || 'http://localhost:8081/v1/embeddings';
  const model = process.env.EMBED_MODEL || 'Qwen/Qwen3-Embedding-4B';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.EMBED_KEY ? { authorization: `Bearer ${process.env.EMBED_KEY}` } : {}),
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) throw new Error(`embed endpoint ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data.map((d) => d.embedding);
}

export async function embed(texts) {
  return BACKEND === 'http' ? embedHttp(texts) : embedMiniLM(texts);
}

/**
 * Split text into ~maxChars chunks on paragraph boundaries, with a little
 * overlap. Good enough for a prototype; a real version respects chapter structure.
 */
export function chunk(text, maxChars = 900, overlap = 150) {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const chunks = [];
  let buf = '';
  for (const p of paras) {
    if (buf && (buf.length + 1 + p.length) > maxChars) {
      chunks.push(buf);
      buf = buf.slice(Math.max(0, buf.length - overlap));
    }
    buf = buf ? `${buf} ${p}` : p;
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}
