# Deployment Guide

CB8 is a Postgres-backed Node server. One build produces two bundles that ship
together and run as separate processes:

- **`dist/standalone.mjs`** — the Fastify API + web UI. Serves the React SPA
  (built to `dist/web`) and the entire `/api`. It only *enqueues* heavy work.
- **`dist/worker.mjs`** — the background worker. Connects to the same Postgres,
  drains the pg-boss job queues (library scans, ebook search backfill), and
  runs the auto-rescan scheduler. **Without a worker, scans never execute** —
  adding a library path just queues a job.

Both read `DATABASE_URL` and refuse to start without it. This document covers
the generic targets (Docker, standalone Node/k8s); the production freya runbook
is [`../DEPLOY.md`](../DEPLOY.md).

## Build Targets

```sh
pnpm build:renderer      # build the React SPA into dist/web
pnpm build:standalone    # build dist/standalone.mjs + dist/worker.mjs
                         # (runs build:renderer first via its prebuild hook)
pnpm start:standalone    # run the built API server (needs DATABASE_URL)
```

Run `pnpm typecheck` and `pnpm test` before shipping a release. Postgres-backed
tests are opt-in: they skip unless `CB8_TEST_DATABASE_URL` points at a
throwaway pgvector database (see `src/main/test/pgTestDb.ts`).

## Requirements

- **Node 20+** for standalone runs (the Docker image uses Node 22).
- **Postgres with the pgvector extension** (the manifests use
  `pgvector/pgvector:pg18`). The schema is created automatically on first
  connection — point `DATABASE_URL` at an empty database and the app
  initializes it. The `vector` extension backs the ebook semantic-search index.
- **7-Zip** for CBZ/CBR reading: `7z` on `PATH`, or `CB8_SEVENZIP_PATH`
  pointing at a `7z`, `7zz`, or `7za` executable. The Docker image installs
  `p7zip-full` (and `unrar` for CBR). The server probes the binary at first use
  and fails with a clear error if it is missing.

## Standalone Node

```sh
pnpm install
pnpm build:standalone
DATABASE_URL=postgres://cb8:<pw>@localhost:5432/cb8 node dist/standalone.mjs
DATABASE_URL=postgres://cb8:<pw>@localhost:5432/cb8 node dist/worker.mjs   # separate process
```

`CB8_DATA_DIR` (default `/var/lib/cb8`) holds only the regenerable image cache
and uploaded archives — the catalog, covers, users, sessions, search vectors,
and job queue all live in Postgres. Run both processes against the same
`CB8_DATA_DIR` so they see the same uploads and cache. Systemd units for both
processes live in `packaging/systemd/`.

## Docker

Docker packaging lives under `packaging/docker/` and mirrors the k8s topology
(`packaging/k8s/`): a Postgres container plus the CB8 API and background worker.

```sh
cd packaging/docker
./cb8-init.sh                 # generate .env with CB8_DB_PASSWORD + BETTER_AUTH_SECRET
docker compose build          # or set CB8_IMAGE in .env to pull a prebuilt image
docker compose up -d
```

This starts three services — `cb8-postgres` (pgvector/pgvector:pg18), `cb8`
(API, published on `CB8_PUBLISH_PORT`, default 4218 → container 8008), and
`cb8-worker`. **Durable data lives in the `cb8-postgres-data` volume**
(catalog, covers, users, search vectors, job queue); `CB8_DATA_DIR` is just
cache + uploads. The compose file mounts `CB8_COMICS_PATH` / `CB8_EBOOKS_PATH`
read-only into both containers as `/comics` and `/ebooks`. For a LAN-only home
deployment, publish the port only on the trusted network.

After the stack is healthy, sign in as admin and add the library paths
(`/comics`, `/ebooks`) from the web UI to trigger the first scan.

## LAN discovery (mDNS)

The API advertises itself over mDNS as **`_cb8._tcp.local.`** on the port it
listens on, so the client apps can offer "servers on your network" instead of
asking the user to type an IP. The TXT records are `ver` (package version),
`name` (the instance display name — `app_meta.server_name`, defaulting to the
machine hostname) and `path=/api`.

It is **on by default for bare-node**, **off in the shipped Docker image**, and
opt-out anywhere via `CB8_MDNS=0`. Advertisement is best-effort: a host with no
multicast route logs a warning and serves normally. Discovery is a convenience,
never a requirement — **QR pairing and typing the address are the fallbacks and
always work.**

Verify an advertisement from another machine on the same LAN:

```sh
dns-sd -B _cb8._tcp             # macOS
avahi-browse -rt _cb8._tcp      # Linux (avahi-utils)
```

### Why containers don't get discovered

mDNS is multicast to the local link. A container on Docker's **default bridge
network has its own network namespace**: its multicast never reaches your LAN,
and the address it would advertise is a bridge IP (`172.17.x.x`) that no phone
on the LAN can route to. Advertising a server nobody can connect to is worse
than advertising nothing — it puts a dead entry in every client's list — so the
image presets `CB8_MDNS=0` and the compose stack ships with discovery off.

Two ways forward:

1. **Host networking** (Linux only). Put the container on the host's network
   stack with `network_mode: host` *and* `CB8_MDNS=1` — a commented variant is
   in `packaging/docker/docker-compose.yaml`. Note that `ports:` is invalid
   under host networking, so **`CB8_PUBLISH_PORT` stops applying**: the server
   binds `CB8_PORT` directly on the host. Postgres stays on the bridge, so
   point `DATABASE_URL` at `127.0.0.1` and publish `5432`. On Docker Desktop
   (macOS/Windows) containers run inside a VM, so host networking is the *VM's*
   network — discovery still won't reach your LAN.
2. **Leave it off** and pair by QR or by typing the host's address. This is the
   expected path for bridge, Docker Desktop, k8s, and reverse-proxied
   deployments, and it costs the user one scan of a QR code.

The same reasoning applies to **Kubernetes** (`packaging/k8s/`): pod networking
is not the LAN's broadcast domain, so `CB8_MDNS` stays unset/off there and
clients connect via the Service address.

## Environment variables

Grouped by concern. A variable only matters to the process that reads it (API
vs worker); both share the same image.

### Core

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | *(required)* | Postgres connection string. Both processes throw on startup without it. |
| `CB8_DATA_DIR` | `/var/lib/cb8` | Image cache (`image-cache/`), uploads (`web-uploads/`). Regenerable. |
| `CB8_PORT` | `8008` | API listen port (API only; the worker has no HTTP listener). |
| `CB8_HOST` | `0.0.0.0` | API bind address. |
| `CB8_WEB_ROOT` | *(auto-detected)* | Override the SPA static-asset directory. Rarely needed; the image serves `/app/web`. |
| `CB8_CORS_ORIGIN` | *(empty)* | CORS allowed origin. Unset by default — the SPA is same-origin. |
| `CB8_MDNS` | `1` bare-node / `0` in the image | Advertise `_cb8._tcp.local.` on the LAN so client apps can auto-discover this server (API only). `0` or `false` opts out. The Dockerfile presets `0` — see [LAN discovery](#lan-discovery-mdns). Advertisement failure is never fatal. |
| `CB8_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |

### Auth (better-auth)

| Variable | Default | Notes |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | *(auto-generated, persisted in `app_meta`)* | Signs session cookies; keep it stable — rotating logs everyone out. Must be ≥ 32 chars if set. Set explicitly in multi-replica deploys. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | *(unset)* | Comma-separated extra origins, added to the auto-computed set (base URL, loopback, detected LAN IPv4s). Every `scheme://host:port` you reach the app by must be trusted or sign-in is rejected as cross-site. |
| `BETTER_AUTH_URL` | `http://localhost:8008` | Auth base URL; used for reset links and to seed trusted origins. Set to the public URL behind a proxy. |
| `CB8_TRUST_PROXY_HEADERS` | *(unset)* | Set to `1` behind a reverse proxy so `X-Forwarded-Host`/`-Proto` are honoured for origin checks and rate-limit client IPs. |

### Ingest / archives

| Variable | Default | Notes |
| --- | --- | --- |
| `CB8_INGEST_CONCURRENCY` | `4` | Archives opened + thumbnailed in parallel during a scan (worker; the shipped workers set `8`). |
| `CB8_SEVENZIP_PATH` | `7z` on `PATH` | Path to the 7-Zip binary (image sets `/usr/bin/7z`). |
| `CB8_UNRAR_PATH` | *(auto-detected)* | Path to `unrar` for CBR; falls back to 7-Zip. |
| `CB8_ARCHIVE_LIST_TIMEOUT_MS` | `60000` | Per-archive listing timeout. |
| `CB8_ARCHIVE_EXTRACT_TIMEOUT_MS` | `30000` | Per-entry extraction timeout. |

### Optional services

| Variable | Default | Notes |
| --- | --- | --- |
| `EMBED_URL` / `EMBED_MODEL` / `EMBED_KEY` | *(see wiki Configuration)* | OpenAI-compatible embeddings endpoint for ebook semantic search. API embeds queries; worker embeds book text. Fails soft when unreachable. |
| `SEARCH_BACKFILL_ON_START` | *(unset)* | `"1"` makes the **worker** enqueue an idempotent search-index backfill at startup. |
| `UPSCALE_URL` | *(see wiki Configuration)* | Real-ESRGAN page-upscale endpoint (API only). Failures serve the original page. |
| `CB8_UPSCALE_CACHE_DIR` | `<CB8_DATA_DIR>/upscale-cache` | Durable cache for upscaled pages. |
| `COMICVINE_API_KEY` | *(unset)* | Enables the ComicVine metadata scraper source. |

The full user-facing reference (including Docker-compose-level variables like
`CB8_PUBLISH_PORT`, `CB8_DB_PASSWORD`, `CB8_COMICS_PATH`) is on the wiki's
[Configuration page](../packaging/wiki/content/configuration.md).

## First Admin Account

On first boot against an empty database, CB8 creates an `admin` user and prints
the generated password to stdout. The same password is visible in **Settings →
Temporary password** until it is changed, at which point the stored copy is
wiped. There is no public signup and no self-service email reset — admins
create users and reset passwords from **User management**. If the admin
password is lost after the stored copy is cleared, reset the admin row in
Postgres, or recreate the database and rescan the library (the on-disk files
are the source of truth and are never modified).
