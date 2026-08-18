# Ebook semantic search — prototype

Phase 1 of the "search your library by what's inside it" idea, scoped to
**e-books only** (no comic OCR yet). It proves the whole pipeline:

```
EPUB text ─► chunk ─► embeddings ─► Postgres (FTS + pgvector)
                                          │
question ─► embed + keyword ─► hybrid search (RRF) ─┘ ─► passages ─► (RAG) answer
```

Standalone — own deps, a throwaway local Postgres, local embeddings by default —
so it never touches the CB8 server.

## Run it

```bash
# 1. local Postgres with pgvector
docker run -d --name cb8-proto-pg -p 5433:5432 \
  -e POSTGRES_USER=cb8 -e POSTGRES_PASSWORD=cb8 -e POSTGRES_DB=cb8 \
  pgvector/pgvector:pg16

# 2. deps + index some public-domain EPUBs (drop them in ./books)
npm install
node ingest.mjs books/some-book.epub

# 3. search (no key needed) ...
node query.mjs "a detective deduces a stranger's past from small clues"

# 4. ... or ask (needs ANTHROPIC_API_KEY; retrieves then has Claude answer w/ citations)
ANTHROPIC_API_KEY=sk-... node ask.mjs "how does the creature first meet its maker?"
```

`DATABASE_URL` overrides the connection (default `postgres://cb8:cb8@localhost:5433/cb8`).

## Embedding backend (pluggable — see `embed.mjs`)

| `EMBED_BACKEND` | what | when |
|---|---|---|
| `minilm` *(default)* | local `all-MiniLM-L6-v2` (384-d) via transformers.js | testing — zero setup, no key |
| `http` | OpenAI-compatible `/v1/embeddings` endpoint | production — a GPU model on the 3090 |

Switching models changes the vector dimension → set `EMBED_DIM` to match and
re-create the table (drop + re-ingest).

## Production embeddings on the 3090

The Node process should **not** run the model in production. Stand up a GPU
embedding server on the 3090 and point the `http` backend at it:

```bash
EMBED_BACKEND=http \
EMBED_URL=http://gpu-box:8081/v1/embeddings \
EMBED_MODEL=Qwen/Qwen3-Embedding-4B \
EMBED_DIM=1024 \
node ingest.mjs books/*.epub
```

**Serving:** Hugging Face TEI, Infinity, or vLLM — all expose `/v1/embeddings` and
batch on the GPU.

**Model (24 GB is generous — pick for quality):**
- **Qwen3-Embedding-8B** — ~16 GB in fp16, near the top of MTEB. Best quality.
- **Qwen3-Embedding-4B** — ~8 GB, nearly as good, much faster; leaves VRAM for batching. **Good default.**
- Simpler/lighter, still strong: **bge-large-en-v1.5** (1024-d) or **stella_en_1.5B_v5** (1024-d).

**pgvector dimension caveat (important):** the HNSW index supports **≤ 2000 dims** for `vector` (≤ 4000 for `halfvec`). Qwen3's native dims are large (4B = 2560, 8B = 4096), so use the models' **Matryoshka (MRL) truncation to 1024–1536 dims** — keeps the index fast/small with negligible quality loss — and set `EMBED_DIM` accordingly. (`bge-large`/`stella` are 1024 natively, no truncation needed.)

**Before committing:** the swap is config-only + a re-embed, so benchmark 2–3
candidates on a sample of *your own* books and compare retrieval quality.

## What's left (Phase 2+)
- Promote `ask.mjs` into a real RAG endpoint; optionally run the LLM locally on the 3090 too.
- Integrate into the CB8 server: a `/api/search` route + an embed-on-import hook, and switch the production Postgres to a pgvector-capable image.
- Comic **OCR** (the expensive half) feeding this same index — bubble detection shares infra with the paused Guided View idea.
