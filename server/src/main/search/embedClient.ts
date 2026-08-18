/**
 * @module
 * Client for the GPU embedding service (Infinity / vLLM on the mars 3090),
 * exposed in-cluster with an OpenAI-compatible embeddings API. Configurable via
 * env so the model/endpoint can change without code edits.
 */

const EMBED_URL = process.env.EMBED_URL || 'http://cb8-embeddings:8000/embeddings';
const EMBED_MODEL = process.env.EMBED_MODEL || 'Qwen/Qwen3-Embedding-4B';

/** pgvector column dimension. Qwen3-4B is MRL-truncated to this; bge-large is
 *  natively this — so the schema is the same either way. */
export const EMBED_DIM = 1024;

/** Truncate (Matryoshka) to EMBED_DIM and L2-renormalize. No-op if already smaller. */
function fit(vec: number[]): number[] {
  const v = vec.length > EMBED_DIM ? vec.slice(0, EMBED_DIM) : vec;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** TEI caps a single request at 32 inputs; send in sub-batches to stay under it. */
const MAX_BATCH = 32;

/** Embed strings → array of EMBED_DIM-length vectors (in input order). */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const res = await fetch(EMBED_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.EMBED_KEY ? { authorization: `Bearer ${process.env.EMBED_KEY}` } : {}),
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: batch }),
    });
    if (!res.ok) {
      throw new Error(`embed endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    for (const d of json.data) out.push(fit(d.embedding));
  }
  return out;
}

/** pgvector accepts the text form `[1,2,3]`. */
export const toVector = (arr: number[]): string => `[${arr.join(',')}]`;

/**
 * True when an error means the embedding service itself is unreachable or
 * unhealthy (mars/TEI down, GPU fault → 503, overloaded), as opposed to a
 * problem with one specific input. Callers use this to skip work quietly instead
 * of hammering every item when the GPU node is offline.
 */
export function isEmbeddingServiceDown(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // undici throws TypeError('fetch failed') with the syscall code on .cause.
  const code = (err as { cause?: { code?: string } }).cause?.code;
  if (code && ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET'].includes(code)) return true;
  if (err.message === 'fetch failed') return true;
  // Endpoint reachable but unhealthy/overloaded (e.g. GPU fault → 503, 429, 5xx).
  return /embed endpoint (5\d\d|429)/.test(err.message);
}
