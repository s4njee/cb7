# AGENTS.md

Guidance for AI coding agents working in `webui/`. Humans: see
[`README.md`](README.md) for an overview and [`ARCHITECTURE.md`](ARCHITECTURE.md) for the
full design.

## What this is

CB8 is a self-hosted **comic & e-book server**: a Fastify HTTP API + **Postgres**
catalog + React SPA, shipped as **two Node processes** from one TypeScript codebase —
the API server (`src/main/standalone.ts`) and a pg-boss background worker
(`src/main/worker.ts`). It lives under `webui/` in a monorepo whose root is the Flutter
client that speaks this server's REST API.

There is **no Electron and no SQLite** anymore — no `index.ts`/`preload.ts`/IPC, no
desktop mode. Electron-era comments still linger in some files (e.g. the `createPg.ts`
header); treat them as history, not instructions.

**Read [`ARCHITECTURE.md`](ARCHITECTURE.md) before non-trivial changes**, and use
[`docs/STUDY_GUIDE.md`](docs/STUDY_GUIDE.md) as the file-by-file map. The notes below
are the operational essentials.

## Setup, build, and test

Run from `webui/` with pnpm:

```sh
pnpm install --frozen-lockfile

pnpm typecheck            # tsc --noEmit — must be clean
pnpm test                 # Vitest (plain Node; no Electron runner)

pnpm dev:renderer         # Vite dev server for the SPA (proxies /api to :8008)
pnpm build:renderer       # build src/renderer → dist/web
pnpm build:standalone     # build dist/standalone.mjs + dist/worker.mjs (runs build:renderer first)
pnpm start:standalone     # run the built API server (needs DATABASE_URL)
pnpm docs:api             # TypeDoc → docs/api/
```

- **Postgres-backed tests are opt-in**: they skip unless `CB8_TEST_DATABASE_URL`
  points at a throwaway **pgvector-enabled** Postgres (see `src/main/test/pgTestDb.ts`).
  Run them when touching `src/main/db/` or route behavior:

  ```sh
  CB8_TEST_DATABASE_URL=postgres://cb8:pw@localhost:5432/cb8_test pnpm test
  ```

- Running the server needs `DATABASE_URL` (pgvector Postgres; the schema is applied
  idempotently on first connect) and — for library scans to actually execute — the
  worker process (`node dist/worker.mjs`). The API only enqueues.
- Before handing off: `pnpm typecheck`, `pnpm test`, and `pnpm build:renderer` after
  frontend changes. Mention any skipped check.

## Project layout

```
src/main/                 Node side
  standalone.ts           API entry (Fastify; producer-only pg-boss)
  worker.ts               Worker entry (pg-boss consumer + auto-rescan scheduler)
  libraryDatabase.ts      DB façade — one async method per operation
  db/                     Postgres DAOs; pg.ts helper; schema/createPg.ts (idempotent DDL)
  jobs/                   queues.ts (contract), boss.ts, producer.ts, handlers.ts
  webServer/              server.ts (buildServer), middleware, auth (better-auth),
                          rateLimit, archiveCache, mapping, ingest bridge
    routes/               one file per resource; each exports handle: RouteHandler
  search/                 ebook semantic search (FTS + pgvector, RRF fusion)
  ingestService.ts etc.   ingest pipeline, archive loaders, image resize cache
src/renderer/             React 18 SPA (Vite + Tailwind + shadcn/ui, HashRouter)
  components/layout/AppShell.tsx   the route table + persistent chrome
  pages/  components/  hooks/  lib/api/  store/
src/shared/               pure TS shared by both sides (types, apiTypes, sorting…)
packaging/                docker, k8s, argocd, systemd, GPU sidecars, wiki
scripts/build-standalone.mjs      esbuild bundle of both entry points
vite.renderer.config.ts   SPA build (dist/web, vendor-react/vendor-query chunks)
```

## Conventions & rules

- **RouteHandler pattern.** API endpoints live in `src/main/webServer/routes/<resource>.ts`;
  each exports `handle: RouteHandler` that inspects `ctx.pathname`/`ctx.method` and
  returns `true` when it owns the request. Respond via `sendJson`/`sendError`
  (`middleware.ts`), parse via `routes/validation.ts` helpers, gate admin actions with
  `requireAdmin(ctx)`, and format paged lists with `routes/routeResponseHelpers.ts`.
- **No SQL in routes.** Read/write logic goes in `db/<domain>.ts`, exposed through
  `libraryDatabase.ts`. Domain functions take the `Db` interface from `db/pg.ts`
  (works for both pool and transaction).
- **Schema DDL must be idempotent.** `db/schema/createPg.ts` re-runs on every boot —
  new tables/indexes use `CREATE … IF NOT EXISTS`, new columns
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. There is no migrations table.
- **Wire types live in `src/shared/apiTypes.ts`**, imported by both server and
  renderer so the contract can't drift. `src/shared/` stays pure — no Node APIs, no DOM.
- **Heavy work goes through the job queue.** Routes enqueue via `jobs/producer.ts`;
  the worker's `jobs/handlers.ts` executes. If a handler might run for minutes, it's a job.
- **Module doc-comment style.** Non-trivial modules open with an
  `@module` doc comment headed "Architecture overview for Junior Devs" explaining the
  file's role and design choices. Keep them accurate when changing behavior; write one
  for substantial new modules.
- **Tests are colocated Vitest** (`foo.ts` + `foo.test.ts` next to it). Extract
  testable policy into pure `*Helpers.ts` / `*Rules.ts` files instead of testing
  through components/handlers.
- **Renderer state:** server data in React Query (`lib/queryClient.ts`), UI state in
  Zustand stores. API calls go through `lib/api/<domain>.ts` (via `client.ts`); keep UI
  imports on the `@/lib/api` barrel.
- **Match existing idioms** — look at neighboring files before introducing a new
  pattern, dependency, or directory.

## Gotchas (don't relearn these the hard way)

- **`reply.hijack()` — Fastify never sees API responses.** `/api/*` is dispatched to
  raw-`http` handlers after hijacking the reply, so Fastify plugins, serializers, and
  `onSend` payload hooks do **not** apply to API responses (the CORS `onSend` hook works
  because headers are set before handlers write). Don't add a Fastify plugin and expect
  it to affect `/api/*`; global behavior belongs in `dispatchApi` / `serverHelpers.ts`.
- **Guest 401s are by design.** Anonymous access (when `guest_access` is on) is
  read-only; guest writes (e.g. progress) return 401 and clients treat that as normal.
  Don't "fix" it, and don't weaken `canAccessApiRequest`.
- **No public signup — and email synthesis is load-bearing.** Sign-up endpoints 403;
  `/api/auth/register` requires an admin. `db/users.ts:createUser` synthesizes
  `username@localhost` and fills `email_verified`/`display_username`/`name` because
  better-auth's username plugin rejects sign-ins for rows where those are null. Create
  users only through `createUser`, or the account can never log in.
- **Two per-user-state paths — keep them consistent.** The main library listing joins
  progress/favorites in SQL (`queryComicsForUser`); other endpoints overlay via
  `webServer/mapping.ts`. For lists always use `overlayUserStateMany` (two queries
  total), never `overlayUserState` in a loop (N+1).
- **List queries skip the cover BLOB on purpose** (`COMIC_NO_BLOB_COLUMNS`,
  `getComicLite`). Covers are `BYTEA` on the row; selecting them in lists drags
  megabytes through every page. Don't add `cover_thumbnail` to a list select.
- **The rate limiter must cover better-auth's sign-in routes.** The SPA logs in via
  `/api/auth/sign-in/username`, not the legacy `/api/auth/login` — the preHandler in
  `server.ts` covers both plus `/sign-in/email`. Keep new auth endpoints behind it.
  Related: proxy IPs are only trusted with `CB8_TRUST_PROXY_HEADERS=1`.
- **Scans need the worker.** `add-path`/rescan endpoints only enqueue; without
  `dist/worker.mjs` running, jobs sit in the queue forever. (Uploads ingest in-process
  and work without it.)
- **`mapping.ts` is a security boundary.** `toWebRecord` strips the server file path;
  never return raw `MediaRecord`s from a route.
- **Optional sidecars fail soft.** Semantic search (`EMBED_URL`) and HD upscaling
  (`UPSCALE_URL`) are optional; keep new integrations degrading gracefully when unset.
- **The netcup overlay is decommissioned.** `packaging/k8s/overlays/netcup` is legacy;
  the only production target is the freya k3s cluster via Argo CD (see
  [DEPLOY.md](DEPLOY.md)). Don't build on the netcup overlay.

## Testing notes

- Pure logic: colocated `*.test.ts` run everywhere by plain `pnpm test`.
- DB/route behavior: Postgres-backed suites (e.g. `db/comics.query.test.ts`,
  `webServer/authRoutes.test.ts`, `jobs/jobs.integration.test.ts`) self-skip without
  `CB8_TEST_DATABASE_URL`; they create/drop their own state via `src/main/test/pgTestDb.ts`.
  Passing CI with them skipped is not proof a DB change works — run them locally.
- Don't rely on local comic collections; tests generate their own fixtures.

## Relationship to the Flutter app

The Flutter client at the monorepo root speaks this server's REST API verbatim (routes,
camelCase fields, better-auth session cookie). `webServer/routes/*` + `mapping.ts` +
`src/shared/apiTypes.ts` **are the contract** — breaking changes to response shapes
break the app (and OPDS/WebPub reader apps). Extend additively where possible.

## Scope & safety

- Don't commit, push, or open PRs unless asked.
- **Never delete or move users' comic/book files.** Library removal updates the
  database only; ingest references files in place.
- New state-mutating routes must be gated (`requireAdmin`, or an explicit
  authenticated-user check) — the guest gate only protects reads.
- Keep outbound HTTP behind `webServer/safeFetch.ts` (SSRF protection) unless there is
  a deliberate, documented reason.
- Deployment is GitOps: changes under `packaging/k8s` roll out automatically via
  Argo CD. Don't edit manifests casually, don't `kubectl apply` by hand — follow
  [DEPLOY.md](DEPLOY.md).
- Keep generated/build output out of commits: `node_modules/`, `dist/`, `docs/api/`,
  local libraries/archives, and scratch output.
