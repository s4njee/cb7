---
title: Configuration
description: Environment variables, secrets, and optional services for the CB8 server
published: true
date: 2026-07-06T00:00:00.000Z
tags: cb8, configuration, reference
editor: markdown
dateCreated: 2026-06-30T00:00:00.000Z
---

# Configuration

This page is the complete reference for every setting CB8 understands. It looks
long, but don't let that worry you: **most people only set a handful of these —
see the short list below — and can safely ignore the rest.** The defaults are
sensible. Skim the callout, set what applies to you, and move on.

CB8 is configured entirely through **environment variables** — named settings the
app reads when it starts (see [Glossary](/glossary)). There is no config file to
edit. You set them in your [Docker Compose `.env`](/installation/docker), your
[Kubernetes manifests](/installation/kubernetes), or your service manager unit on
[bare metal](/installation/bare-metal), then restart the process.

> ### The few you actually need
>
> For a normal setup, these are the only settings you'll touch:
>
> - **`DATABASE_URL`** (or, in Docker, **`CB8_DB_PASSWORD`**) — how CB8 reaches
>   its database.
> - **`BETTER_AUTH_SECRET`** — the key that secures logins. Set once, then leave
>   it alone.
> - **`BETTER_AUTH_TRUSTED_ORIGINS`** — every web address you use to reach CB8.
> - **Your library paths** — where your comics and e-books live (in Docker,
>   `CB8_COMICS_PATH` / `CB8_EBOOKS_PATH`).
> - **The port** — the number you'll type in your browser (`CB8_PUBLISH_PORT` in
>   Docker, or `CB8_PORT` on bare metal).
>
> Everything below this callout is optional fine-tuning. If a setting isn't in
> this list, you can almost certainly leave it at its default.

Two processes read these variables, and they share the same image:

- **`cb8`** — the Fastify API + web UI (`dist/standalone.mjs`). It serves pages and the SPA and only *enqueues* heavy jobs.
- **`cb8-worker`** — the background worker (`dist/worker.mjs`). It *drains* the job queues (library scans, ebook search backfill) and runs the auto-rescan scheduler.

Both connect to the same Postgres. A variable only matters to the process that reads it; where that distinction is load-bearing it is called out in the table.

> The catalog (series, covers, users, sessions, reading progress, search vectors, the job queue) lives entirely in **Postgres**. The only on-disk state is the regenerable image cache and uploaded archives under `CB8_DATA_DIR`. See [Architecture](/architecture) for the full picture.

---

## Required

These must be set or the server will not start.

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | *(none — required)* | Postgres connection string, e.g. `postgres://cb8:PW@host:5432/cb8`. Both `cb8` and `cb8-worker` throw on startup if it is unset (`DATABASE_URL is required (a Postgres connection string)`). Postgres must have the **pgvector** extension available for ebook semantic search (the deployment manifests use the `pgvector/pgvector:pg18` image). |

> CB8's server is Postgres-only — both entry points (`cb8` and `cb8-worker`) require it. (An earlier desktop/Electron build kept its catalog in SQLite; that build is retired, and the native client is now the Flutter app.)

---

## Core / server

| Variable | Default | Description |
| --- | --- | --- |
| `CB8_DATA_DIR` | `/var/lib/cb8` | Directory for the image cache (`<CB8_DATA_DIR>/image-cache`) and uploaded archives (`<CB8_DATA_DIR>/web-uploads`). **Not** the catalog — that is in Postgres. The `cb8` and `cb8-worker` containers should share this path so both see the same uploads and cache. |
| `CB8_PORT` | `8008` | TCP port the API listens on. Read only by the `cb8` API process (the worker has no HTTP listener). |
| `CB8_HOST` | `0.0.0.0` | Bind address for the API. Read only by the `cb8` API process. |
| `CB8_WEB_ROOT` | *(unset — auto-detected)* | Override the directory the SPA static assets are served from. Rarely needed; the image already places the built UI where the server finds it (`/app/web`). If set to a path that does not exist, the server logs a warning and SPA assets will 404. |
| `CB8_CORS_ORIGIN` | `""` (empty — no cross-origin access) | CORS allowed origin for the API. The SPA is served from the same origin, so this is unset by default. Set it to a specific origin, or to `"*"` for legacy trusted-LAN behavior. |

---

## Authentication (better-auth)

Login, sessions, and password verification are handled by the `better-auth` library. See [Generating secrets](#generating-secrets) and [Trusted origins](#trusted-origins) below before deploying.

| Variable | Default | Description |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | *(auto-generated and persisted in Postgres)* | Signs auth session cookies. **Keep it STABLE.** If set, it must be **at least 32 characters** or it is ignored. When unset (or too short), the server reads a secret stored in the `app_meta` table, generating and persisting a random one on first boot so sessions survive restarts. Provide an explicit value in multi-replica or container deploys so every instance signs with the same key. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | *(unset)* | Comma-separated list of extra origins better-auth will accept. These are **added** to an auto-computed set (the base URL, loopback hosts on the same port, and detected LAN IPv4 addresses). List every `scheme://host:port` the app is actually reached by — see [Trusted origins](#trusted-origins). |
| `BETTER_AUTH_URL` | `http://localhost:8008` | Auth base URL, used to build links (e.g. password-reset emails) and seed the trusted-origin set. Set this to your public/proxied URL when running behind a reverse proxy. |
| `CB8_TRUST_PROXY_HEADERS` | *(unset)* | Set to `1` **only** when CB8 sits behind a reverse proxy, so the forwarded `X-Forwarded-Host` / `X-Forwarded-Proto` headers are honoured for origin checks and the rate limiter sees real client IPs. Leave unset when clients hit CB8 directly — trusting these headers from arbitrary clients would let them spoof their origin/IP. See [Reverse proxy](/reverse-proxy). |

### Accounts, signup, and guests

Two access-policy facts worth knowing that are **not** environment variables:

- **There is no public signup.** The sign-up endpoints are disabled server-side
  (they return `403 Public signup is disabled`); an **admin** creates every
  account from **User management** in the web UI (or via the admin-only
  `/api/users` endpoint). Accounts are username-only — CB8 synthesizes an
  internal `username@localhost` email for the auth library, so no real email
  address is ever required. There is also no self-service password reset; the
  sign-in page's "Forgot password?" directs users to an admin.
- **Guest access** (whether signed-out visitors can browse and read) is a
  runtime setting stored in the database (`app_meta`), toggled by an admin
  under **Settings → Guest access** in the UI — not an environment variable.
  It defaults to **on**. It also governs anonymous access to the OPDS catalog
  (below).

### Generating secrets

Generate a strong `BETTER_AUTH_SECRET` once and store it (e.g. in your `.env` or a Kubernetes Secret):

```bash
openssl rand -hex 32
```

> **Warning — rotating `BETTER_AUTH_SECRET` logs everyone out.** The secret signs session cookies; changing it invalidates every existing session, so all users (including admins) must sign in again. Generate it once and keep it stable across restarts and across all replicas.

### Trusted origins

better-auth rejects sign-in requests whose origin it does not trust, returning the login as a cross-site request. CB8 automatically trusts:

- the configured `BETTER_AUTH_URL` (default `http://localhost:8008`),
- the standard loopback hosts (`localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`) on that URL's port, and
- every non-internal IPv4 LAN address detected on the host, on that same port.

If you reach CB8 by **any other** `scheme://host:port` — a different published port, a hostname or `.local` name, a reverse-proxy URL, or HTTPS — you must add it to `BETTER_AUTH_TRUSTED_ORIGINS`, or logins from that address are rejected. List every variant you use:

```bash
BETTER_AUTH_TRUSTED_ORIGINS=http://192.168.1.248:4218,http://freya.local:4218,http://freya:4218
```

> Origins must match exactly, including scheme and port. `http://host:4218` and `https://host:4218` are different origins, as are `:4218` and `:31456`.

---

## Archive handling

CB8 opens CBZ and CBR comic archives to list pages and extract covers. CBZ (zip) goes through the `7z` binary; CBR (RAR) prefers `unrar` when available, falling back to `7z`. (PDF and EPUB/MOBI books are handled by their own readers, not these tools.)

| Variable | Default | Description |
| --- | --- | --- |
| `CB8_INGEST_CONCURRENCY` | `4` | Number of archives opened + thumbnailed in parallel during a scan. Must parse to a positive integer or the default is used. The Docker worker and the k8s worker set this to `8` for faster bulk ingest on beefier hosts; lower it on small NAS / container hosts to avoid resource contention. |
| `CB8_ARCHIVE_LIST_TIMEOUT_MS` | `60000` | Per-archive listing timeout in milliseconds (must be a positive integer, else the default applies). Raise it for very large or slow archives. |
| `CB8_ARCHIVE_EXTRACT_TIMEOUT_MS` | `30000` | Per-archive extraction timeout in milliseconds (positive integer, else default). Governs single-entry extraction via the external archive tools. |
| `CB8_SEVENZIP_PATH` | `7z` (image sets `/usr/bin/7z`) | Path to the 7-Zip binary used for CBZ (and as a RAR fallback for CBR). When unset, the server resolves `7z` from `PATH`. The Docker image installs `p7zip-full` and sets this to `/usr/bin/7z`. The server probes the binary and errors with a clear message if it is missing. |
| `CB8_UNRAR_PATH` | *(unset — auto-detected)* | Path to the `unrar` binary for CBR/RAR. When unset, the loader probes `/usr/bin/unrar`, `/usr/local/bin/unrar`, then `unrar` on `PATH`; if none work it falls back to `7z`. The Docker image installs `unrar`, so this is normally unnecessary. |

---

## Optional services (GPU)

Two optional GPU-backed services enrich the experience. Both are wired in purely by environment variables and fail soft: if the endpoint is unreachable, ebook semantic search degrades and comic upscaling silently serves the normal page. See [Optional GPU services](#optional-gpu-services) for deployment notes.

| Variable | Default | Description |
| --- | --- | --- |
| `EMBED_URL` | `http://cb8-embeddings:8000/embeddings` | OpenAI-compatible embeddings endpoint used for ebook semantic search. *(The k8s/Compose deployments override this to `http://cb8-embeddings:8000/v1/embeddings` to match the TEI server's API path — set it to whatever path your embeddings server actually serves.)* |
| `EMBED_MODEL` | `Qwen/Qwen3-Embedding-4B` | Model id sent with each embeddings request. The deployment manifests set `BAAI/bge-large-en-v1.5`. Embeddings are truncated/normalized to a fixed **1024** dimensions to match the pgvector column, so the chosen model must produce vectors of at least 1024 dimensions. |
| `EMBED_KEY` | *(unset)* | API key for the embeddings endpoint. When set, requests carry `Authorization: Bearer <EMBED_KEY>`; when unset, no auth header is sent. |
| `UPSCALE_URL` | `http://cb8-upscale:8000/upscale` | Real-ESRGAN comic-page upscaler endpoint. The API POSTs raw page bytes and expects upscaled WebP bytes back. Any failure is treated as "serve the normal page". |
| `CB8_UPSCALE_CACHE_DIR` | `<CB8_DATA_DIR>/upscale-cache` | Directory for cached upscaled pages. Read by the `cb8` API process. Point it at durable storage (the k8s manifest uses a dedicated PVC at `/var/lib/cb8-upscale-cache`) since regenerating pages is GPU-expensive; the API LRU-evicts within the directory's budget. |
| `SEARCH_BACKFILL_ON_START` | *(unset)* | When set to exactly `"1"`, the **worker** enqueues an idempotent ebook-search backfill job on startup (re-indexing books that lack embeddings). The Docker and k8s workers set this to `"1"`. |

### Optional GPU services

CB8 ships two optional sidecar services in the deployment manifests; both run on a GPU node and are reached over the cluster network. They are entirely optional — without them, ebook semantic search and comic HD upscaling are simply unavailable.

**Embeddings service (ebook semantic search).** An OpenAI-compatible embeddings server (the manifests use Hugging Face TEI serving `BAAI/bge-large-en-v1.5`, a 1024-dimension model). Wire it in with:

- `EMBED_URL` — the embeddings endpoint (set it to the actual API path, e.g. `.../v1/embeddings`),
- `EMBED_MODEL` — the model id to request,
- `EMBED_KEY` — optional bearer token if the endpoint requires auth.

Both the `cb8` API and the `cb8-worker` set `EMBED_URL`/`EMBED_MODEL` (the API for query-time embedding, the worker for indexing). Set `SEARCH_BACKFILL_ON_START=1` on the worker to (re)build the index on start. Model output must be at least 1024-dimensional to fill the pgvector column.

**Upscale service (comic HD pages).** A Real-ESRGAN HTTP service that takes raw page bytes and returns a 2x WebP. Wire it in with:

- `UPSCALE_URL` — the upscale endpoint,
- `CB8_UPSCALE_CACHE_DIR` — durable cache for the (expensive) results.

Only the `cb8` API talks to the upscaler. If `UPSCALE_URL` is unreachable, the API serves the original page unchanged.

See the [Kubernetes guide](/installation/kubernetes) for the full `embeddings.yaml` / `upscale.yaml` manifests, including the GPU node placement.

---

## OPDS catalog (zero config)

CB8 serves an **OPDS catalog** for third-party reader apps at `/api/opds`, with
a Readium **WebPub manifest** per book at `/api/comics/<id>/manifest`. There is
nothing to configure — it shares the API's address and port, and the signed-in
**Settings** page shows the exact catalog URL under **Connect a reader app**.
The guest-access setting above decides whether an OPDS app needs to be signed
in to read. See [Usage](/usage) for the walkthrough.

---

## Logging / misc

| Variable | Default | Description |
| --- | --- | --- |
| `CB8_LOG_LEVEL` | `info` | Log verbosity. Valid values: `debug`, `info`, `warn`, `error` (case-insensitive). Anything else falls back to `info`. Messages below the threshold are suppressed. |
| `COMICVINE_API_KEY` | *(unset)* | ComicVine API key for metadata scraping. When set, the metadata search adapter queries the ComicVine API (volume search) for candidate matches an admin can apply. When unset, ComicVine contributes no results (other sources like AniList and MangaDex still work). |
| `NODE_ENV` | `production` (set in the image) | Standard Node environment flag. The Docker image sets it to `production`. |
| `UV_THREADPOOL_SIZE` | `64` (set in the image) | libuv thread-pool size. The Docker image raises this to `64` so concurrent `sharp` image encodes and file I/O during scans are not throttled by the default pool size. |

---

## Putting it together

- **Docker Compose:** set values in `.env` next to the compose file; see [Docker installation](/installation/docker).
- **Kubernetes:** values come from the Deployment `env:` blocks and the `cb8-db` / `cb8-secrets` Secrets; see [Kubernetes installation](/installation/kubernetes).
- **Bare metal:** export the variables in your service manager unit; see [Bare-metal installation](/installation/bare-metal).

For day-to-day operation after the server is configured (adding libraries, scanning, reading), see [Usage](/usage).
