# CB8

CB8 is a self-hosted comic and book server for the library you already own. Point it at the folders where your `.cbz`, `.cbr`, `.epub`, `.pdf`, and `.mobi` files live and it builds a browsable, searchable catalog over them — covers, metadata, reading progress, tags, and collections — without ever moving, renaming, or rewriting the originals. Your files stay exactly where they are; CB8 only keeps a catalog alongside them.

Under the hood it is a **Fastify HTTP server + Postgres catalog + React SPA**, shipped as two Node processes built from one codebase: the **API server** (`dist/standalone.mjs`), which serves the SPA and the whole `/api`, and a **background worker** (`dist/worker.mjs`), which drains the durable job queue (library scans, search indexing, auto-rescans). It runs in Docker, on Kubernetes, or as a plain Node process on a VPS — the web UI is identical everywhere, and any browser on your LAN gets the same reading experience. There is also a native [Flutter client](../README.md) (iOS / Android / macOS) in this monorepo that can point at the same server.

The reader is the point: a fast, full-screen page view tuned for long sessions — immersive chrome that stays out of the way (tap the center of the page to toggle it), pinch / pan / swipe on touch, keyboard shortcuts on desktop, single-page or two-page spreads, and left-to-right or right-to-left paging for manga. EPUBs get a reflowable text reader with themes, adjustable type, and a whole-book "% read" position. Because everything is one index over files you control, you can rescan, re-tag, or remove items from the library at any time and your actual files are never touched.

> Non-generated AI. I built this for myself because I couldn't find a manga reader I liked. There may be bugs — file an issue or send a PR. I'll fix what I run into.

<img width="1668" height="1312" alt="Screenshot_20260427_140312" src="https://github.com/user-attachments/assets/66bf41a4-d29f-4211-a596-3c0f12b5397b" />
<img width="2542" height="1180" alt="Screenshot_20260427_140351" src="https://github.com/user-attachments/assets/f62c4768-8e72-4045-a862-d04ed7a8f6be" />


## How it works

CB8 scans the folders you give it and records what it finds in Postgres — one row per book, plus generated cover thumbnails. Archives (`.cbz` / `.cbr`) are read in place: when you open a comic, pages are extracted and decoded on demand and cached, so nothing is unpacked to disk ahead of time. EPUBs, PDFs, and MOBIs are parsed for their own structure and rendered by the matching reader. Reading position, bookmarks, favorites, and tags are stored against that catalog per user, so picking up where you left off works across every browser (and the Flutter app) pointed at the same server.

The heavy lifting is split across two processes: the API server only *enqueues* scans and indexing jobs; the worker *drains* them from a pg-boss queue that lives in the same Postgres. Jobs are durable and idempotent — an interrupted scan resumes after a restart, and re-running one never duplicates rows.

Everything is organized as a view over the catalog rather than a layout on disk. Tags, virtual folders, series grouping, collections, and search all rearrange how the library is presented without ever moving the underlying files, and deleting an item only drops its catalog row. That makes the library safe to experiment with and trivial to rebuild — if anything looks off, a rescan reconstructs it from the files themselves.

## Features

- Reads `.cbz`, `.cbr`, `.epub`, `.pdf`, and `.mobi`. Image entries inside archives are sorted with natural filename ordering (`page2.jpg` before `page10.jpg`).
- Page-by-page comic reader with immersive auto-hiding chrome, pinch / pan / swipe on touch, and keyboard navigation on desktop; EPUB reader with themes, adjustable type, and whole-book progress; PDF reader via pdf.js.
- Continuity-first home page: a **Continue reading** hero card plus an up-next row, then the library grid.
- **⌘K / Ctrl+K command palette** for jumping to books, collections, folders, tags, and actions; `/` focuses the search box.
- **Multi-user** with admin and regular accounts, per-user read state, and optional **guest access** (guests can browse and read; progress isn't saved). There is no public signup — an admin creates accounts.
- **OPDS catalog + Readium WebPub manifests** (`/api/opds`, `/api/comics/:id/manifest`) so external reader apps can browse and stream the library. The catalog URL is shown under **Settings → Connect a reader app**.
- Optional **e-book semantic search** (hybrid Postgres FTS + pgvector, via an embeddings sidecar) and optional **HD comic upscaling** (Real-ESRGAN sidecar with a disk cache). Both fail soft when unconfigured.
- **Watched folders**: the worker auto-rescans registered library paths on an interval, so new files show up without manual rescans.
- Library scanned from folders or drag-and-drop / upload. Cover thumbnails are generated and cached; search, tags, virtual folders, and collections never move files on disk.
- Removing items from the library only deletes the database row; the underlying files stay on disk.

See [docs/READER.md](docs/READER.md) for a tour of the reader UI.

## Installation

CB8 needs a **pgvector-enabled Postgres** and ships two ways — the catalog format and web UI are identical:

| Target | What you get | Best for |
| --- | --- | --- |
| **Docker Compose** | Postgres + API + worker from [`packaging/docker`](packaging/docker). | Home server, NAS. |
| **Standalone** | `dist/standalone.mjs` + `dist/worker.mjs`, run on plain Node 20+. | VPS, Kubernetes ([`packaging/k8s`](packaging/k8s)), anywhere you bring your own Postgres. |

CBZ and CBR reading uses a native 7-Zip executable through `node-7z`. Docker
images install this automatically. Bare-metal runs need `7z` on `PATH`, or
`CB8_SEVENZIP_PATH` pointing at a `7z`, `7zz`, or `7za` executable.

### Quick start — Docker

The compose file brings up Postgres, the API, and the background worker
together (mirrors `packaging/k8s`):

```sh
cd packaging/docker
./cb8-init.sh                   # generates .env with CB8_DB_PASSWORD + BETTER_AUTH_SECRET
docker compose up -d --build    # or set CB8_IMAGE in .env to pull a prebuilt image
```

Then open `http://<host>:4218/`, sign in as admin, and add your library paths.

### Quick start — Standalone

```sh
pnpm install && pnpm build:standalone
# Requires a pgvector-enabled Postgres; the schema is created on first connect.
DATABASE_URL=postgres://cb8:<pw>@localhost:5432/cb8 node dist/standalone.mjs
DATABASE_URL=postgres://cb8:<pw>@localhost:5432/cb8 node dist/worker.mjs   # separate process
```

The worker must be running for library scans to actually execute — the API only
enqueues them.

## First Run

On first launch CB8 creates a single `admin` account and stores its initial password in the database under `app_meta`. The password is also printed to stdout:

```
============================================================
[CB8] Initial admin account created.
      username: admin
      password: <random 24-char string>
      Sign in and change this password immediately.
============================================================
```

The password remains visible in **Settings → Temporary password** until you change it (at which point CB8 wipes the stored copy). If you lose it before changing it, sign in with the value shown there. If the row has been cleared and you don't remember the password, reset the admin against Postgres and let CB8 recreate a fresh admin on next launch — your catalog lives in that same database, so you'll then re-scan the library.

The server binds to `0.0.0.0:8008` by default (`CB8_HOST` / `CB8_PORT`); the Docker stack publishes it on host port `4218`. Any origin you reach the UI by beyond the auto-detected LAN addresses must be listed in `BETTER_AUTH_TRUSTED_ORIGINS` or sign-ins from it are rejected.

## Development

```sh
pnpm install
pnpm dev:renderer       # Vite dev server for the React renderer
pnpm build:renderer     # build src/renderer into dist/web
pnpm build:standalone   # build dist/standalone.mjs + dist/worker.mjs (runs build:renderer first)
pnpm start:standalone   # run the built server (needs DATABASE_URL)
pnpm test               # vitest; Postgres-backed tests are opt-in via CB8_TEST_DATABASE_URL
pnpm typecheck          # tsc --noEmit
pnpm docs:api           # TypeDoc HTML API docs into docs/api/
```

DB-backed tests skip themselves unless `CB8_TEST_DATABASE_URL` points at a
throwaway pgvector Postgres (see `src/main/test/pgTestDb.ts`).

## Project Layout

- `src/main/` — server code: Postgres access (`db/`), ingest pipeline, archive loading, the embedded Fastify server (`webServer/`), job queue (`jobs/`), semantic search (`search/`), and the two entry points `standalone.ts` / `worker.ts`.
- `src/renderer/` — React + shadcn/Tailwind frontend. Vite builds this into `dist/web`, which the server serves to every client.
- `src/shared/` — pure types and small utilities used by both sides.
- `docs/` — contributor docs (deployment, reader guide, study guide, diagrams).
- `packaging/docker/` — Dockerfile, `docker-compose.yaml`, and the `cb8-init.sh` secret bootstrap.
- `packaging/k8s/` — Kubernetes manifests (API, worker, Postgres, optional GPU sidecars) with a kustomization for per-cluster overrides.
- `packaging/argocd/` — the Argo CD `Application` that deploys `packaging/k8s` via GitOps (see [DEPLOY.md](DEPLOY.md)).
- `packaging/systemd/` — systemd unit for bare-metal mode.
- `packaging/wiki/` — the user-facing wiki content (installation, configuration, usage, operations).

## Documentation map

- [DEPLOY.md](DEPLOY.md) — the operational runbook for the production (freya k3s + Argo CD) deployment.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — general deployment guide: build targets, Docker, standalone, environment variables.
- [docs/READER.md](docs/READER.md) — reader UI behavior and code entry points.
- [docs/STUDY_GUIDE.md](docs/STUDY_GUIDE.md) — file-by-file onboarding tour of the codebase.
- [docs/diagrams.md](docs/diagrams.md) — small Mermaid diagrams of the main request flows.
- [CONTRIBUTING.md](CONTRIBUTING.md) — new-contributor setup and "how to add X".
- [packaging/wiki/content/](packaging/wiki/content) — user-facing wiki (usage, configuration, installation, troubleshooting).

## License

MIT — see [LICENSE](LICENSE).
