# CB8 Server — Architecture

CB8 is a self-hosted comic & e-book server: a **Fastify HTTP API + Postgres
catalog + React SPA**, shipped as **two Node processes built from one
TypeScript codebase**:

- **API server** (`src/main/standalone.ts` → `dist/standalone.mjs`) — serves the
  SPA and the whole `/api`. Only *enqueues* heavy work.
- **Background worker** (`src/main/worker.ts` → `dist/worker.mjs`) — drains the
  pg-boss job queue: library scans, search-index backfills, auto-rescans. No
  HTTP listener.

Both connect to the same **pgvector-enabled Postgres**, which holds *all*
durable state — catalog, covers, users/sessions, per-user progress, search
vectors, and the job queue itself. The only on-disk state is a regenerable
image cache and uploaded archives under `CB8_DATA_DIR`.

> **Historical note.** CB8 previously also shipped as an Electron desktop app
> over SQLite. That mode is retired: there is no Electron entry point, no
> preload/IPC layer, and no SQLite in this package. The native client is now
> the [Flutter app](../ARCHITECTURE.md) at the monorepo root, which speaks this
> server's REST API. You will still meet Electron/SQLite-era comments in older
> modules and SQLite→Postgres translation notes in `db/schema/` — they are
> historical context, not current behavior.

**How to read this document.** If you're new here, read §1–§4 in order —
big picture → request flow → auth → data — then skim the rest. Each section
names the files it describes; keep the code open beside it. The per-file
"what does this file do" tables live in
[docs/STUDY_GUIDE.md](docs/STUDY_GUIDE.md); this document explains how the
pieces fit and *why*. Many modules also carry an
"Architecture overview for Junior Devs" doc-comment at the top — those are the
authoritative local explanations.

---

## 1. The big picture

```
  Browser (React SPA)     Flutter app      OPDS / WebPub reader apps
        │                     │                      │
        └───────────── HTTP: /api/* + static ────────┘
                              │
              ┌───────────────▼─────────────────────────────┐
              │  API server — dist/standalone.mjs           │
              │  Fastify (webServer/server.ts)              │
              │   hooks: rate-limit, CORS                   │
              │   /api/auth/* → better-auth handler         │
              │   /api/*      → dispatchApi → RouteHandlers │
              │   everything else → static SPA (dist/web)   │
              │                                             │
              │  routes → LibraryDatabase → db/* (pg)       │
              │  page reads → archiveCache → imageResizer   │
              │  heavy work → jobs/producer.ts (enqueue)    │
              └───────────────┬─────────────────────────────┘
                              │  pg-boss queue (in Postgres)
              ┌───────────────▼─────────────────────────────┐
              │  Worker — dist/worker.mjs                   │
              │  jobs/handlers.ts:                          │
              │   ingest-scan     → IngestService           │
              │   search-backfill → search/indexer          │
              │  + FolderScheduler (auto-rescan enqueuer)   │
              └───────────────┬─────────────────────────────┘
                              │
                     Postgres (pgvector)
        catalog · users/sessions · progress · ebook_chunks · jobs
```

The key idea: **the UI is a web app, full stop.** There is no privileged
client — the SPA, the Flutter app, and OPDS readers all speak the same HTTP
API. The typical data flow is:

```
React component → src/renderer/lib/api/* → fetch('/api/...') →
  src/main/webServer/routes/* → src/main/db/* → Postgres
```

Anything slow (scanning a folder, indexing book text) detours through the job
queue: a route calls `jobs/producer.ts` to enqueue, and the worker's handlers
do the work. Jobs are durable (they live in Postgres) and idempotent, so a
restart resumes in-flight work and re-delivery never duplicates rows.

---

## 2. Tech stack & layout

| Concern | Choice |
| --- | --- |
| HTTP server | Fastify 5 (`webServer/server.ts`), plus raw-`http` route handlers behind `dispatchApi` |
| Database | Postgres via `pg` (pool), **pgvector required**; schema applied idempotently on boot |
| Auth | `better-auth` with the **username plugin** (cookie sessions) |
| Job queue | `pg-boss` (queue tables live in the same Postgres) |
| Images | `sharp` (+ `@jsquash/jxl` decode), on-disk resize cache |
| Archives | `yauzl` (CBZ), `unrar` / 7-Zip via `node-7z` (CBR) |
| Frontend | React 18 + Vite + Tailwind + shadcn/ui (Radix), `HashRouter` |
| Frontend state | `@tanstack/react-query` (server data) + Zustand (UI state) |
| Tests | Vitest, colocated `*.test.ts`; Postgres suites gated by `CB8_TEST_DATABASE_URL` |

| Path | Purpose |
| --- | --- |
| `src/main/` | Node side: DB (`db/`), ingest, archive readers, the Fastify server (`webServer/`), job queue (`jobs/`), semantic search (`search/`), entry points. |
| `src/renderer/` | React 18 SPA. `pnpm build:renderer` compiles it into `dist/web`, which the server serves to every client. |
| `src/shared/` | Pure TypeScript usable from both sides (types, sorting, validators). No DOM, no Node APIs. |
| `packaging/` | Docker, k8s, Argo CD, systemd, GPU sidecars (embeddings, upscale), wiki content. |
| `scripts/` | `build-standalone.mjs` (esbuild bundle of both entry points), benchmarks. |
| `vite.renderer.config.ts` | The SPA build: `dist/web` output, `vendor-react` / `vendor-query` manual chunks, dev proxy of `/api`. |

Three entry points:

- `src/main/standalone.ts` — API server. Reads `DATABASE_URL` (required),
  `CB8_DATA_DIR`, `CB8_HOST`, `CB8_PORT`; opens the DB, starts pg-boss in
  **producer-only** mode, builds the Fastify server, listens.
- `src/main/worker.ts` — worker. Same DB, pg-boss as a **full consumer**
  (maintenance + cron), registers the job handlers, starts the auto-rescan
  scheduler. Runs the same image as the API, just a different command.
- `src/renderer/main.tsx` — SPA entry (mounts `<App />`).

(`src/main/webServer.ts` is a thin `startWebServer()` façade kept for
programmatic embedding; the standalone entry calls `buildServer` directly.)

---

## 3. The API server: how a request flows

`buildServer(db)` in `src/main/webServer/server.ts` assembles the Fastify
instance. In order:

1. **Startup side effects** — `ensureInitialAdmin(db)` (creates the `admin`
   account on first run and stashes its printed password in `app_meta`), then
   `createAuth(db.pool)` builds the better-auth instance.
2. **Body handling** — Fastify's content-type parsers are removed entirely.
   The route handlers consume the raw request stream themselves via
   `readBody()` (with `BodyTooLargeError` size limits), so the stream must
   arrive untouched.
3. **Hooks** — an `onSend` hook adds CORS headers only when `CB8_CORS_ORIGIN`
   is set (the bundled SPA is same-origin, so CORS is opt-in), and a
   `preHandler` hook applies the login / forgot-password **rate limiters**
   (§4).
4. **`/api/*` mount** — one catch-all Fastify route that calls
   `reply.hijack()` and hands the **raw** `IncomingMessage`/`ServerResponse`
   to `dispatchApi`. Hijacking means Fastify's reply pipeline (serializers,
   `onSend` payload rewriting, its logger's response events) never sees API
   responses — the handlers write directly to the socket.
5. **Static SPA** — everything else falls through to `serveStatic`
   (`routes/staticFiles.ts`), which serves `dist/web` with an `index.html`
   fallback for the hash router. Hashed `/assets/` files get
   `Cache-Control: public, max-age=31536000, immutable`; everything else is
   `no-cache`, so deploys pick up instantly while vendor chunks stay cached.

### dispatchApi and the RouteHandler pattern

`dispatchApi` is the adapter between Fastify and the per-resource route
modules:

1. Parse the URL into `pathname` + `query`.
2. If the path belongs to better-auth (`shouldDelegateToBetterAuth` in
   `serverHelpers.ts`), forward to the better-auth node handler and stop.
3. Resolve the current user from the session cookie
   (`getAuth().api.getSession`) into a `ResolvedUser` (`id`, `username`,
   `isAdmin`).
4. Apply the guest gate: `canAccessApiRequest` (in `serverHelpers.ts`) returns
   401 for anonymous requests unless guest access is enabled — and even then
   only for read-style endpoints. **Guest writes 401 by design**; clients
   (including the Flutter app) treat that as expected.
5. Build a `RequestContext` and try each module in `API_ROUTES` order.

The contract lives in `webServer/context.ts`:

```ts
interface RequestContext {
  req; res; db;              // raw request/response + LibraryDatabase
  pathname; method; query;   // parsed request
  currentUser;               // ResolvedUser | null
  guestEnabled;              // boolean
}
type RouteHandler = (ctx: RequestContext) => Promise<boolean>;
```

Each file in `webServer/routes/` exports one `handle: RouteHandler` that
inspects `ctx.pathname` / `ctx.method`, and returns `true` when it owned the
request ("I handled this — stop dispatching") or `false` to pass. If nothing
claims the request, `dispatchApi` sends a 404.

Conventions inside handlers:

- **Responses** go through `sendJson` / `sendError` (`middleware.ts`) — never
  hand-rolled `res.writeHead` for JSON.
- **Parsing** goes through `routes/validation.ts` (`requireCurrentUser`,
  `requireComic` — which uses the blob-free `getComicLite`, `readJsonBody`,
  `parseBoundedInteger`, `readPageIndex`).
- **Admin gating** is `requireAdmin(ctx)` from `context.ts` (sends 401/403
  itself; the caller just bails).
- **Paged list responses** (`{ records, totalCount }`) go through
  `routes/routeResponseHelpers.ts` so `comics`, `folders`, and `libraries`
  can't drift in wire shape.
- Pure, testable parsing/policy rules live in colocated
  `*RouteHelpers.ts` files with `.test.ts` next to them.

The route inventory (one file per resource): `auth`, `users`, `upload` (the
admin ingest surface under `/api/admin/*`), `comics` (records, thumbnails,
pages with `?width=` / `?upscale=1`, file download, metadata search),
`webpub` (`GET /api/comics/:id/manifest`, a Readium WebPub manifest),
`opds` (`GET /api/opds`, an OPDS 2 catalog), `progress`, `tags`, `libraries`
(shown as "Collections" in the UI), `folders`, `search` (hybrid ebook search),
`jobs` (`GET /api/jobs`, scan-progress polling), and `staticFiles`.

### Page reads (the hot path)

`GET /api/comics/:id/pages/:n` → `routes/comics.ts` → `withArchive` from
`webServer/archiveCache.ts` (an LRU of open archive handles keyed by comic id,
refcounted so concurrent fetches share one open handle) → `archiveLoader`
extracts the page → `imageResizer.ts` resizes via sharp and caches the result
on disk under `CB8_DATA_DIR/image-cache`. With `?upscale=1`,
`upscaleClient.ts` proxies through the optional Real-ESRGAN sidecar
(`UPSCALE_URL`) with its own disk cache; it fails soft when unconfigured.

---

## 4. Auth & sessions

`webServer/auth.ts` configures **better-auth** directly against the `pg.Pool`,
mapped onto CB8's own `users` table (better-auth's `session` / `account` /
`verification` tables are part of the schema). Points worth knowing:

- **Username-first.** The username plugin allows signing in with username *or*
  email (`POST /api/auth/sign-in/username`). There are no real emails in this
  self-hosted model, so `db/users.ts:createUser` **synthesizes
  `username@localhost`** and populates `email_verified` / `display_username` /
  `name` up front — the username plugin validates the returned user shape on
  sign-in and rejects rows where those are null. Create users through
  `createUser`, or accounts will exist but never be able to log in.
- **No public signup.** better-auth's native sign-up endpoints return 403
  (`routes/auth.ts`), and `/api/auth/register` requires an admin session.
  Accounts are admin-created (Users page / `POST /api/auth/register`).
- **Persistent signing secret.** `BETTER_AUTH_SECRET` if set; otherwise a
  generated secret persisted in `app_meta` under `auth_secret`, so session
  cookies survive restarts.
- **Trusted origins.** Auto-detected LAN addresses plus
  `BETTER_AUTH_TRUSTED_ORIGINS`; any origin you reach the UI by beyond those
  must be listed or sign-ins from it are rejected.
- **Proxy headers are ignored by default.** `X-Forwarded-*` is only honored
  when `CB8_TRUST_PROXY_HEADERS=1` (`serverHelpers.ts`) — otherwise a client
  could spoof its IP past the rate limiter.
- **Rate limiting** (`rateLimit.ts`, applied as a Fastify `preHandler`): the
  login limiter covers `/api/auth/login` **and** better-auth's native
  `/api/auth/sign-in/username` / `/api/auth/sign-in/email` — the SPA signs in
  via the latter, so limiting only the legacy path would leave brute-force
  wide open. A separate limiter covers forgot-password.
- **First run**: `ensureInitialAdmin` creates `admin` with a random password,
  prints it to stdout, and keeps it readable in **Settings → Temporary
  password** (stored in `app_meta`) until changed.
- **Guest access** is an `app_meta` flag (cached; invalidated on change).
  Guests can browse and read; their progress writes get 401 and their reads
  fall back to the shared position stored on the comic row itself.

---

## 5. Database layer — `src/main/db/`

**Postgres-only.** The pattern: `libraryDatabase.ts` is a thin async façade —
it owns one `pg.Pool` (built by `db/schema/openPg.ts`) and exposes one method
per logical operation, each delegating to a free function in a per-domain file
(`comics.ts`, `folders.ts`, `libraries.ts`, `tags.ts`, `users.ts`,
`progress.ts`, `bookmarks.ts`, `favorites.ts`, `history.ts`, `ebookSearch.ts`,
`jobs.ts`, `ingestErrors.ts`, `appMeta.ts`, `maintenance.ts`). SQL never lives
in routes.

- **`db/pg.ts`** — the minimal promise-based helper every domain function
  receives: `all` / `get` / `run` / `tx`, implemented by both `PgDatabase`
  (pool-backed) and `PgTx` (inside a transaction) behind one `Db` interface.
  It rewrites SQLite-style `?` placeholders to `$1..$n` and parses `int8`
  back to JS numbers, which is why most of the ported SQL reads unchanged.
- **`db/schema/createPg.ts`** — the `PG_SCHEMA` string. **This is the data
  model, and it is fully idempotent**: every table/index is
  `CREATE … IF NOT EXISTS`, new columns are `ADD COLUMN IF NOT EXISTS`, so the
  whole thing re-runs harmlessly on every boot and existing databases upgrade
  in place. There is no migrations table. The header documents the
  SQLite→Postgres translation choices (STORED `tsvector` `search_vector` with
  a GIN index instead of FTS5; `lower()` expression indexes instead of
  `COLLATE NOCASE`; `BYTEA` covers; better-auth tables on `timestamptz`).
  Hot-path indexes live here too (title/series `lower()` indexes, `last_read`
  partial index, per-user progress index, membership indexes, the
  `ebook_chunks` GIN + HNSW pair).
- **`db/schema/openPg.ts`** — builds the pool and applies the schema on
  startup. pgvector must be available (`CREATE EXTENSION vector` is part of
  setup); the stock `pgvector/pgvector:pg16` image works.

### Records, blobs, and per-user state

Cover thumbnails are `BYTEA` on the `comics` row, which creates two recurring
performance rules:

- **List queries skip the blob.** `db/types.ts` defines column sets;
  `COMIC_NO_BLOB_COLUMNS` selects everything except `cover_thumbnail`, and
  `getComicLite` is the blob-free single-record fetch used on hot paths (page
  reads, `requireComic`). Never add the cover column to a list select "for
  convenience" — covers are fetched lazily via `/api/comics/:id/thumbnail`.
- **Per-user state has two paths.** The main library listing
  (`queryComicsForUser` + `comicQueryHelpers.ts`) joins the current user's
  progress/favorites **in SQL**. Other endpoints map rows with
  `webServer/mapping.ts` — `toWebRecord` (strips the server file path; the
  boundary that decides what leaves the server) then `overlayUserState` /
  `overlayUserStateMany`. For lists, always use **`overlayUserStateMany`**: it
  fetches progress + favorites for all ids in two total queries, instead of
  the two-queries-per-record N+1 the singular version costs in a loop.

**Schema change recipe:** add idempotent DDL to `createPg.ts` → read/write in
the domain file → expose via `libraryDatabase.ts` → Postgres-backed test
(gated by `CB8_TEST_DATABASE_URL`; see `src/main/test/pgTestDb.ts`).

---

## 6. The job queue — `src/main/jobs/`

Heavy work never runs in a request handler. The split:

| File | Role |
| --- | --- |
| `queues.ts` | Queue names + typed job payloads — the producer/worker contract. Add a job type here first. |
| `boss.ts` | pg-boss lifecycle: `startBoss(url, { producerOnly })` for the API (enqueue only, no maintenance/cron) vs the full worker; `stopBoss`. |
| `producer.ts` | `enqueueScan` / `enqueueBackfill` — what routes call. Scans support priority lanes (auto-rescans go in low). |
| `handlers.ts` | The implementations the worker runs: `handleIngestScan`, `handleSearchBackfill`, plus the EPUB page-count backfill. |

The worker registers each queue with `batchSize: 1` — one heavy job at a time
per queue; a scan already parallelizes internally
(`CB8_INGEST_CONCURRENCY`). `FolderScheduler` (in `src/main/`) drives
**auto-rescans**: on an interval from `auto_rescan_interval_min` in `app_meta`
(0 disables), it enqueues a durable incremental scan job per registered
library folder — it never scans inline, so a worker restart resumes cleanly.

Progress the UI can see lives in the `scan_jobs` mirror table (`db/jobs.ts`),
updated by the handlers and polled via `GET /api/jobs`. Handlers are
idempotent: re-running a scan upserts by `file_path` rather than duplicating
rows.

**If the worker isn't running, scans never execute** — the API only enqueues
and immediately returns a job id.

---

## 7. Ingest — getting files into the library

Two entry paths, both admin-only, both landing in the same pipeline:

- **Upload / drag-and-drop** — `POST /api/admin/upload` (`routes/upload.ts`)
  streams archives into `CB8_DATA_DIR/web-uploads/`, then ingests them
  in-process via `webServer/ingest.ts`, which bridges to `IngestService` with
  a streaming NDJSON event interface so the UI shows per-file progress live.
- **Add server path** — `POST /api/admin/add-path` registers a folder and
  enqueues an `ingest-scan` job; the worker walks it. Rescans (manual from the
  folders route, or automatic via `FolderScheduler`) are the same job with
  `since` for incremental discovery.

The pipeline itself (`src/main/`): `ingestDiscovery.ts` collects matching file
paths (recursively or incrementally — it never parses archives);
`ingestService.ts` runs a bounded producer/consumer queue
(`CB8_INGEST_CONCURRENCY`, default 4) that probes each file, extracts a cover
(`archiveLoader` for CBZ/CBR, `epubCoverExtractor` / `pdfCoverExtractor` for
books, `thumbnailGenerator` for encoding), parses series/volume/chapter from
the filename (`seriesParser.ts` — pure and heavily unit-tested), and batches
inserts inside transactions. Failures are classified and persisted by
`ingestErrorLog.ts` so the UI can show what dropped and why. Files are
**referenced in place** — ingest never moves, renames, or rewrites them, and
removing a library record only deletes the DB row.

---

## 8. Ebook semantic search — `src/main/search/`

Search *inside* e-books, combining Postgres FTS with pgvector similarity.
Optional: it needs an OpenAI-compatible embeddings endpoint (`EMBED_URL`,
`EMBED_MODEL`, `EMBED_DIM`) and fails soft when unconfigured.

- **Data model** — `ebook_chunks` (`createPg.ts`): one row per ~900-char text
  chunk with a generated `tsv` (GIN index) and a `vector(1024)` embedding
  (HNSW cosine index).
- **Indexing** — `epubText.ts` extracts spine-ordered plain text;
  `searchUtil.ts` chunks it; `embedClient.ts` embeds (truncating/renormalizing
  to `EMBED_DIM`); `indexer.ts` upserts idempotently per book. Backfills run
  as the worker's `search-backfill` job (enqueued on worker start when
  `SEARCH_BACKFILL_ON_START=1`, or via `POST /api/search/reindex`).
- **Query** — `GET /api/search?q=` (`routes/search.ts`): embed the query,
  fetch keyword + vector candidates (`db/ebookSearch.ts`), fuse with
  reciprocal-rank fusion (`rrfFuse`), return `{ book, chapter, snippet, via }`
  hits. The SPA surfaces them as an "Inside your books" section on the home
  page and in the command palette.

The production embeddings sidecar (a TEI GPU service) is deployment detail —
see [DEPLOY.md](DEPLOY.md) and `packaging/embeddings/`.

---

## 9. Renderer — `src/renderer/`

A hash-routed React 18 SPA (Vite + Tailwind + shadcn/ui). Two state rules:
**server data lives in React Query** (`lib/queryClient.ts`,
`invalidateLibraryQueries`); **UI state that must survive navigation lives in
Zustand stores**. Don't cache server data in Zustand.

### Shell & routing

`main.tsx` mounts `App.tsx` (QueryClientProvider + HashRouter + session
bootstrap). `components/layout/AppShell.tsx` is the persistent layout **and
the route table**. The real routes:

| Route | Page |
| --- | --- |
| `/` | `AllPage` — home: `ContinueShelf` hero + up-next row above the grid |
| `/recent`, `/continue` | Library-wide views |
| `/login` | `LoginPage` — sign-in (with an inline forgot-password notice; no email reset, it points at an admin) |
| `/settings` | `SettingsPage` — any signed-in user; wraps `SettingsPanel` |
| `/users` | `UsersPage` — admin only (others redirected); wraps `UsersPanel` |
| `/library/:id` | `LibraryPage` (a collection) |
| `/folder/:id[...]`, `/browse/series/:k[...]` | Folder / global series→volume→chapter drill-down (`HierarchyPageFrame`) |
| `/tag/:name` | `TagPage` |
| `/read/:id[/:page]` | `ReaderPage` — rendered as an overlay while the library pages stay mounted underneath, so scroll position survives |
| `/reset-password`, `/verified` | `AuthPages.tsx` |

Chrome around the routes: **`Navbar`** (search box, the add-content `+` menu,
and the **identity chip** — an initials avatar opening Settings / User
management / Sign out, or a Sign in button when logged out), **`Sidebar`**
(desktop nav), the **`CommandPalette`** (⌘K / Ctrl+K — jump to books,
collections, folders, tags, and actions; `/` focuses the search box), and on
mobile the bottom **`TabBar`** with **Home / Browse / Settings**, where Browse
opens the `TabPanel` sheet (Collections / Folders / Tags pivots).

Auth and settings are **real routes**, not modal tabs. `AdminModal`
(`components/admin/`) survives only as the container for the four admin
content actions — `upload`, `add-path`, `create-collection`,
`create-folder` — all admin-gated; the login/settings/users panels it used to
host are now pages that reuse the same panel components.

### Readers

`ReaderPage.tsx` resolves the record and picks the lazy `ComicReader`,
`EpubReader`, or `PdfReader` by media type / extension. All three share
**immersive chrome** via `hooks/useImmersiveChrome.ts`: chrome hidden on open,
center-tap toggles it, 3-second auto-hide while reading, hover pinning on
desktop — the policy is a pure `nextChromeState` rule with colocated tests.
Reader behavior follows a controller/view/rules split (`*View` presentational,
`*Controls`/`*Sheets` UI, pure `comicReaderRules` / `pdfReaderRules` /
`epubReader*` helpers with tests). Preferences (zoom, direction, spread, HD
upscale, EPUB font/theme) persist in `store/readerStore.ts` via
`localStorage`.

### Data access & stores

`lib/api.ts` is a barrel over `lib/api/` — `client.ts` owns fetch + error
handling, `types.ts` the renderer-facing types (wire shapes shared with the
server live in `src/shared/apiTypes.ts`), and one module per endpoint group
(`comics`, `folders`, `libraries`, `reading`, `browse`, `tags`, `admin`,
`users`, `auth`, `settings`, `metadata`, `search`, `jobs`). Stores:
`readerStore` (persisted prefs), `selectionStore` (multi-select for bulk
ops), `uiStore` (admin panel, mobile tab panel, sort sheet).

### Bundle performance

Baked into the shell and `vite.renderer.config.ts`:

- `SettingsPage`, `UsersPage`, and `AdminModal` are `React.lazy`, so admin
  code stays out of the initial bundle; the three readers are lazy inside
  `ReaderPage` (which keeps epub.js / pdf.js out of the eager path).
- `manualChunks` splits `vendor-react` (react, react-dom, react-router-dom)
  and `vendor-query` (react-query, zustand) into stable chunks. Combined with
  the server's `immutable` caching for hashed `/assets/` (§3), app updates
  don't re-download the framework.

---

## 10. Configuration knobs

- **Env vars** — `DATABASE_URL` (required), `CB8_DATA_DIR`, `CB8_HOST`,
  `CB8_PORT`, `CB8_INGEST_CONCURRENCY`, `CB8_SEVENZIP_PATH`, `CB8_UNRAR_PATH`,
  `CB8_ARCHIVE_LIST_TIMEOUT_MS`, `CB8_ARCHIVE_EXTRACT_TIMEOUT_MS`,
  `CB8_CORS_ORIGIN`, `CB8_TRUST_PROXY_HEADERS`, `CB8_WEB_ROOT`,
  `CB8_LOG_LEVEL`, `CB8_MDNS`, `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_TRUSTED_ORIGINS`, and the optional-sidecar vars (`EMBED_URL`,
  `EMBED_MODEL`, `EMBED_DIM`, `SEARCH_BACKFILL_ON_START`, `UPSCALE_URL`).
  Full reference: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **Persistent settings** — the `app_meta` table: `guest_access`,
  `auto_rescan_interval_min`, `auth_secret`, `initial_password` (until
  changed), `server_name` (the mDNS instance name; defaults to the hostname).
- **On-disk artifacts** — `image-cache/`, `web-uploads/`, `upscale-cache/`
  under `CB8_DATA_DIR`. All regenerable; everything durable is in Postgres.

---

## 11. Deployment

The production deployment is **GitOps: Argo CD → k3s** — an Argo `Application`
(`packaging/argocd/cb8.yaml`) watches `server/packaging/k8s` and keeps the
`cb8` namespace in sync (API + worker + Postgres Deployments, plus the
optional GPU sidecars). A deploy is "build/push the image, bump the tag in
`packaging/k8s/kustomization.yaml`, git push".

**[DEPLOY.md](DEPLOY.md) is the operational runbook** — read it before
touching anything under `packaging/`; this document deliberately doesn't
duplicate it. For the generic story (Docker Compose, bare Node, other
clusters) see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## 12. Request paths at a glance

**SPA → data**: `fetch('/api/...')` → Fastify preHandler (rate limit) →
`/api/*` catch-all hijacks the reply → `dispatchApi` resolves the session +
guest gate → `RouteHandler` chain → `LibraryDatabase` → `sendJson`.

**Opening a comic page**: `GET /api/comics/:id/pages/:n?width=` →
`routes/comics.ts` → `withArchive` (shared open handle from `archiveCache`) →
`archiveLoader` extracts → `imageResizer` resizes + disk-caches → bytes.

**Adding a library folder**: AdminModal "Add from server path" →
`POST /api/admin/add-path` → folder row + `enqueueScan` → pg-boss →
worker `handleIngestScan` → `IngestService` batches inserts → UI polls
`GET /api/jobs`; thereafter `FolderScheduler` enqueues incremental rescans.

**Sign-in**: `LoginPage` → `POST /api/auth/sign-in/username` (rate-limited) →
better-auth handler → session cookie → subsequent `dispatchApi` calls resolve
`currentUser` from it.

**In-book search**: search box / ⌘K → `GET /api/search?q=` → embed query →
FTS + vector candidates → RRF fusion → "Inside your books" hits → `/read/:id`.

For the file-by-file map and the "I want to change X — where do I go?" table,
see [docs/STUDY_GUIDE.md](docs/STUDY_GUIDE.md) §6.
