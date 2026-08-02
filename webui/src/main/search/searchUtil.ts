/**
 * @module
 * Pure helpers for ebook search: text chunking and Reciprocal Rank Fusion.
 * No I/O — unit-testable in isolation.
 */

/**
 * Split text into ~maxChars chunks on paragraph boundaries, with a little
 * overlap so a passage split across a boundary is still findable.
 */
export function chunkText(text: string, maxChars = 900, overlap = 150): string[] {
  // Normalize paragraphs, and hard-split any single paragraph longer than
  // maxChars (on word boundaries). Without this, a long paragraph becomes one
  // oversized chunk that blows the embedding model's token limit (bge-large
  // caps at 512 tokens), so it never embeds.
  const pieces: string[] = [];
  for (const raw of text.split(/\n{2,}/)) {
    const p = raw.replace(/\s+/g, ' ').trim();
    if (!p) continue;
    if (p.length <= maxChars) {
      pieces.push(p);
      continue;
    }
    let i = 0;
    while (i < p.length) {
      let end = Math.min(i + maxChars, p.length);
      if (end < p.length) {
        const sp = p.lastIndexOf(' ', end);
        if (sp > i) end = sp; // prefer a word boundary
      }
      pieces.push(p.slice(i, end).trim());
      i = end;
    }
  }
  // Pack pieces up to maxChars with a small overlap tail for cross-boundary recall.
  const chunks: string[] = [];
  let buf = '';
  for (const p of pieces) {
    if (buf && buf.length + 1 + p.length > maxChars) {
      chunks.push(buf);
      buf = buf.slice(Math.max(0, buf.length - overlap));
    }
    buf = buf ? `${buf} ${p}` : p;
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

/**
 * Reciprocal Rank Fusion of several ranked candidate lists. An item's score is
 * the sum of 1/(k + rank) across the lists it appears in, so things ranked
 * highly by either keyword OR semantic search rise, and things in both rise
 * highest. Returns the top `limit` items (deduped by id).
 */
export function rrfFuse<T extends { id: number }>(arms: T[][], k = 60, limit = 8): T[] {
  const score = new Map<number, number>();
  const meta = new Map<number, T>();
  for (const arm of arms) {
    arm.forEach((row, i) => {
      score.set(row.id, (score.get(row.id) ?? 0) + 1 / (k + i + 1));
      meta.set(row.id, row);
    });
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => meta.get(id)!);
}
