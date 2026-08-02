# CB8 Study Guide

A guided tour of the codebase for someone who just cloned it. The goal is that
after reading this you can answer two questions for any task: **"what does this
file do?"** and **"where do I make my change?"**

- For the high-level system design, read [ARCHITECTURE.md](../ARCHITECTURE.md).
- For the terse "how do I add X" checklist, read [CONTRIBUTING.md](../CONTRIBUTING.md).
- This file sits in between: it explains the layout file-by-file and points you
  at the right edit site for common tasks.

---

## 1. The 60-second mental model

CB8 is one TypeScript codebase that ships as **two Node processes built from
one image**:

| Process | Entry point | What runs |
| --- | --- | --- |
| API server | `src/main/standalone.ts` → `dist/standalone.mjs` | Fastify HTTP server: the React SPA + the whole `/api`. Only *enqueues* heavy jobs. |
| Background worker | `src/main/worker.ts` → `dist/worker.mjs` | pg-boss consumer: library scans, ebook search backfill, the auto-rescan scheduler. No HTTP listener. |

Both connect to the same **Postgres** — the catalog, covers, users/sessions,
reading progress, search vectors, and the job queue all live there. The only
on-disk state is a regenerable image cache and uploaded archives under
`CB8_DATA_DIR`.

The key insight that explains the whole repo: **the UI is a web app, full
stop.** The React SPA is served by the Fastify server and calls a normal HTTP
API. So the data flow is almost always:

```
React component → src/renderer/lib/api/* → fetch('/api/...') →
  src/main/webServer/routes/* → src/main/db/* → Postgres
```

Anything slow (scanning a folder, indexing book text) takes a detour: the route
enqueues a job via `src/main/jobs/producer.ts`, and the worker's handlers in
`src/main/jobs/handlers.ts` do the actual work. Jobs are durable (they live in
Postgres) and idempotent, so restarts resume and retries never duplicate rows.

The three source roots:

- **`src/main/`** — Node side. Database, ingest, archive readers, HTTP server,
  jobs, search. Anything that touches the filesystem or `pg`.
- **`src/renderer/`** — the React 18 SPA (Vite + Tailwind + shadcn/ui).
- **`src/shared/`** — pure TypeScript usable from both sides (sorting, types,
  validators). **No DOM, no Node APIs** — that's the rule that keeps it shareable.

> Historical note: CB8 used to also ship as an Electron desktop app over
> SQLite. That mode is gone from this branch — the native client is now the
> Flutter app at the monorepo root — but you'll still meet Electron-era
> comments and the SQLite-to-Postgres translation notes in `db/schema/`.

---

## 2. Suggested reading order

If you read files in this order you'll build up the mental model the way the data
flows, instead of getting lost:

1. **`src/shared/types.ts`** — the core `MediaRecord` and query types. Almost
   everything is a comic/book record; learn its shape first.
2. **`src/main/standalone.ts`** — how the API server boots (barely a page).
   Then skim **`src/main/worker.ts`** for the other half.
3. **`src/main/db/schema/createPg.ts`** — the SQL schema. This *is* the data model.
4. **`src/main/libraryDatabase.ts`** — the façade every DB read/write goes through.
5. **`src/main/webServer/server.ts`** — how an HTTP request gets routed.
6. **`src/main/webServer/routes/comics.ts`** — a representative route handler.
7. **`src/renderer/App.tsx` + `components/layout/AppShell.tsx`** — how the UI
   mounts and where routes are declared.
8. **`src/renderer/lib/api/comics.ts`** — how the UI calls the server.
9. **`src/renderer/pages/AllPage.tsx`** — a page that ties a route to data to UI.

---

## 3. Main process — `src/main/`

### 3.1 Entry points & plumbing

| File | Responsibility | Edit it when… |
| --- | --- | --- |
| `standalone.ts` | API entry. Reads `DATABASE_URL` / `CB8_DATA_DIR` / `CB8_HOST` / `CB8_PORT`, opens the DB, starts pg-boss in producer-only mode, builds the Fastify server, wires SIGINT/SIGTERM shutdown. | You change how the API server boots. |
| `worker.ts` | Worker entry. Same DB, pg-boss as a full consumer, registers the `ingest-scan` and `search-backfill` handlers, starts the `FolderScheduler`. | You change what background work exists or how it starts. |
| `jobs/queues.ts` | Queue names + job payload types — the contract between producer and worker. | Adding a job type (start here). |
| `jobs/boss.ts` | pg-boss lifecycle (`startBoss` producer-only vs full worker, `stopBoss`). | Queue infrastructure. |
| `jobs/producer.ts` | `enqueueScan` / `enqueueBackfill` — what routes call. | Enqueuing behavior. |
| `jobs/handlers.ts` | The actual job implementations the worker runs. | The work itself. |
| `folderScheduler.ts` | Auto-rescan: schedules the *next* run only after the current one finishes, interval from `auto_rescan_interval_min` in `app_meta` (0 disables). Enqueues durable scan jobs rather than scanning inline. | Watched-folder rescan behavior. |
| `sevenZipPath.ts` | Finds a usable `7z`/`7zz`/`7za` binary (honors `CB8_SEVENZIP_PATH`). | 7-Zip discovery issues. |
| `logger.ts` | App-wide logging helper (`CB8_LOG_LEVEL`). | — |
| `upscaleClient.ts` | HTTP client for the optional Real-ESRGAN upscale sidecar (`UPSCALE_URL`); fails soft. | HD page upscaling. |
| `utils/timeout.ts` | `withTimeout` helper used by ingest. | — |

### 3.2 Database — `src/main/db/`

The pattern: **`libraryDatabase.ts` is a thin façade.** It opens one Postgres
pool (via `db/schema/openPg.ts` → `db/pg.ts`) and exposes one async method per
operation; each method delegates to a free function in a per-domain file. So to
change a query you edit the domain file, not the façade (unless you're adding a
brand-new method). Every method is async — callers `await` them.

| File | Owns |
| --- | --- |
| `libraryDatabase.ts` | The façade. One method per logical DB operation; delegates to the files below. Add a method here when you expose a new DB operation to the rest of the app. |
| `pg.ts` | `PgDatabase` / `PgTx` — the thin promise-based helper over `pg.Pool` that every domain function receives. |
| `schema/openPg.ts` | Builds the pool and applies the schema on startup. No corruption-wipe fallback — that was a SQLite concern. |
| `schema/createPg.ts` | The `PG_SCHEMA` string — every table, index, and generated column. **This is the data model.** Fully idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), so it re-runs safely on every boot; the header documents the SQLite→Postgres translation choices (tsvector search column, `lower()` indexes for NOCASE, `BYTEA` covers). |
| `comics.ts` | Comic CRUD, series metadata, paged user queries (`queryComicsForUser`), continue/recently-read lists, and `getComicLite` — the cover-blob-free record fetch used on hot paths. Query construction lives in `comicQueryHelpers.ts` / `folderComicQueryHelpers.ts`; metadata update mapping in `comicMetadataHelpers.ts`. |
| `folders.ts` | Folder CRUD and folder membership. Series/volume/chapter rollup SQL lives in `folderHierarchyQueries.ts`, with scope/record helpers in sibling `folderHierarchy*`/`folderRecordHelpers` files. |
| `libraries.ts` | Libraries (`comic` vs `book` buckets, shown as "Collections" in the UI) and their membership. |
| `tags.ts` | Tag CRUD + bulk ops. |
| `users.ts` | User table, admin counts, credential-account upserts that bridge to better-auth. Synthesizes `username@localhost` emails — accounts are username-first. |
| `progress.ts` | Per-user `user_progress` rows (page index or EPUB CFI + whole-book percent); powers continue/recently-read. |
| `bookmarks.ts` / `favorites.ts` / `history.ts` | Side tables, self-explanatory. |
| `ebookSearch.ts` | FTS + pgvector candidate queries for semantic search. |
| `jobs.ts` | The `scan_jobs` mirror table the UI polls for progress. |
| `ingestErrors.ts` | Per-file ingest failure rows. |
| `appMeta.ts` | Single-row config `get`/`set` against `app_meta` (guest access, rescan interval, auth secret, initial password). |
| `maintenance.ts` | `clearLibrary` — truncate catalog but keep users/auth. |
| `cast.ts` / `transaction.ts` / `types.ts` | Small shared helpers (row casting, transaction wrapper, DB types). |

> **Schema change recipe:** add the DDL to `createPg.ts` — as `CREATE … IF NOT
> EXISTS` for new tables/indexes or `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
> for new columns, so existing databases pick it up on next boot → add the
> read/write in the relevant domain file → expose via `libraryDatabase.ts` →
> add a test like `db/comics.query.test.ts` (Postgres-backed tests run only
> when `CB8_TEST_DATABASE_URL` is set — see `src/main/test/pgTestDb.ts`).

### 3.3 Ingest pipeline (getting files into the library)

| File | Responsibility |
| --- | --- |
| `fileScanner.ts` | Stable public surface (`FileScannerImpl`) used by the upload route and the scan-job handler. Delegates to `IngestService`. |
| `ingestService.ts` | The engine: prepares inserts, runs bounded workers, extracts covers, batches inserts in one transaction, parses series info. Tune concurrency via `CB8_INGEST_CONCURRENCY`. |
| `ingestDiscovery.ts` | Recursive and incremental directory discovery. It only collects matching file paths. |
| `ingestQueue.ts` | Async producer/consumer queue used by ingest workers. |
| `ingestPathHelpers.ts` | Extension sets and series-name inference from scan-root folders. |
| `archiveLoader.ts` | Opens CBZ (yauzl) and CBR (unrar/7-Zip). Provides cover image and page reads. |
| `archiveEntryHelpers.ts` | Filters, orders, and normalizes archive entries. |
| `archivePageHelpers.ts` | Page index validation and byte-bounded in-memory page cache. |
| `archiveProcessHelpers.ts` | Generic `unrar`/`node-7z` process timeout and stream helpers. |
| `epubCoverExtractor.ts` / `pdfCoverExtractor.ts` | Format-specific cover + page-count helpers. |
| `imageDecoder.ts` | Decodes odd formats (e.g. JXL) so `sharp` can handle them. |
| `thumbnailGenerator.ts` | Encodes cover thumbnails (+ placeholder on failure). |
| `imageResizer.ts` | On-demand page resizing via `sharp`, cached on disk under `CB8_DATA_DIR/image-cache`; also owns the upscale cache root. |
| `metadataScraper.ts` | External metadata lookups (ComicVine/AniList/MangaDex, used by the comics route). |
| `seriesParser.ts` | Pure filename parser: `name v01 c003.cbz` → `{ seriesName, volumeNumber, chapterNumber }`. Well unit-tested. |
| `ingestErrorLog.ts` | Classifies/persists per-file failures so the upload UI can show what dropped and why. |

### 3.4 Semantic search — `src/main/search/`

Optional (needs an embeddings endpoint; see `EMBED_URL` in the docs). Fails
soft when unconfigured.

| File | Responsibility |
| --- | --- |
| `embedClient.ts` | Calls the OpenAI-compatible embeddings endpoint (`EMBED_URL`/`EMBED_MODEL`/`EMBED_KEY`). |
| `epubText.ts` | Extracts and chunks EPUB text for indexing. |
| `indexer.ts` | Builds/refreshes the pgvector index (run by the worker's `search-backfill` job). |
| `searchUtil.ts` | `rrfFuse` — reciprocal-rank fusion of keyword (Postgres FTS) and vector candidates. |

### 3.5 Embedded web server — `src/main/webServer/`

This is where most backend work happens. A Fastify instance serves the SPA and
the entire `/api`.

| File | Responsibility | Edit it when… |
| --- | --- | --- |
| `webServer.ts` (parent dir) | Public façade: `startWebServer(db, port, host)` + `getLanIp()`. | Changing how the server is started/stopped. |
| `webServer/server.ts` | `buildServer(db)`: rate-limit hooks, CORS, mounts `/api/auth/*` (better-auth), `/api/*` (`dispatchApi` → the `RouteHandler` chain), and static SPA. | Adding a top-level mount or global hook. |
| `webServer/serverHelpers.ts` | Pure request policy: guest-access API gate, static-root resolution, better-auth delegation, proxy-header trust (`CB8_TRUST_PROXY_HEADERS`). | Cross-cutting request rules (tested). |
| `webServer/middleware.ts` | Cookie parsing, body reading with size limits, guest-access flag (+cache), initial-admin bootstrap (the password banner), `sendJson`/`sendError`. | Cross-cutting request behavior. |
| `webServer/auth.ts` | better-auth setup against Postgres; bridges to our `users` table; persists `auth_secret`; computes trusted origins. | Auth/session behavior. |
| `webServer/authHelpers.ts` | Pure auth helpers (reset links, origin math) with tests. | — |
| `webServer/context.ts` | `RequestContext` and `RouteHandler` types + `requireAdmin`. | Adding shared per-request context. |
| `webServer/routes/*.ts` | **One file per resource.** Each exports `handle: RouteHandler` returning `true` when it owns the request. | **Most endpoint work happens here.** |
| `webServer/routes/validation.ts` | Reusable request helpers: `requireCurrentUser`, `requireComic` (uses `getComicLite`), `readJsonBody`, `parseBoundedInteger`, `readPageIndex`. | Use these in new handlers instead of hand-rolling parsing. |
| `webServer/routes/*RouteHelpers.ts` | Pure parsing, response, and policy helpers for route modules. | Put reusable route rules here with colocated tests. |
| `webServer/routes/routeResponseHelpers.ts` | Shared paged comic/book response formatting. | Use for endpoints that return `{ records, totalCount }`. |
| `webServer/archiveCache.ts` | LRU of open archive handles keyed by comic id; concurrent page fetches share one open handle (`withArchive`). | Page-read performance/caching. |
| `webServer/ingest.ts` | Bridges the upload route to `IngestService` with a streaming event interface. | Upload streaming behavior. |
| `webServer/mapping.ts` | `toWebRecord` / `overlayUserState` / `overlayUserStateMany` — internal `MediaRecord` → API shape + per-user overlay. The `Many` variant batches the per-user lookups for list endpoints instead of one query per record. | Changing what the API returns for a comic. |
| `webServer/rateLimit.ts` | Login + forgot-password limiters. | Rate-limit tuning. |
| `webServer/safeFetch.ts` | SSRF-safe outbound HTTP for the scraper. | Outbound request safety. |
| `webServer/emailSender.ts` | better-auth email hooks; no-ops without SMTP. | Email/verification. |

The route files: `auth.ts` (sign-in; **public signup is disabled** — the
sign-up endpoints return 403 and `/api/auth/register` requires an admin
session), `users.ts` (admin user management), `comics.ts` (records, thumbnails,
pages with `?width=`/`?upscale=1`, file download, metadata search), `folders.ts`,
`libraries.ts`, `progress.ts`, `tags.ts`, `upload.ts`, `search.ts` (hybrid
FTS + vector ebook search), `jobs.ts` (scan-job progress polling), `opds.ts`
(`GET /api/opds` — an OPDS 2 catalog for external reader apps), `webpub.ts`
(`GET /api/comics/:id/manifest` — a Readium WebPub manifest per book), and
`staticFiles.ts` (the SPA, with `immutable` caching for hashed `/assets/`).

> **Add an endpoint recipe:** pick the resource file in `routes/` → parse ids with
> a regex + `parseInt` → use the `validation.ts` helpers → return via `sendJson`/
> `sendError` → if it's a new response shape, define the type in
> `src/shared/apiTypes.ts` and import it on both sides → add/extend a route test
> (see `webServer/authRoutes.test.ts`).

---

## 4. Renderer — `src/renderer/`

A hash-routed React SPA. **Server data** lives in `@tanstack/react-query`;
**UI state that must survive navigation** lives in Zustand stores. Don't reach for
Zustand to cache server data — that's React Query's job.

### 4.1 Entry & shell

| File | Responsibility |
| --- | --- |
| `main.tsx` | React root mount. |
| `App.tsx` | Wraps app in `QueryClientProvider` + `HashRouter`; does session bootstrap. |
| `components/layout/AppShell.tsx` | The persistent layout (navbar, sidebar, mobile tab bar, reader overlay, command palette) and **the `<Routes>` declaration**. Library pages stay mounted (hidden) while the reader is open so scroll position survives. Add a new route here. |
| `index.html` / `globals.css` | HTML shell and global/Tailwind styles. |

Performance notes baked into the shell: `SettingsPage`, `UsersPage`, and
`AdminModal` are `React.lazy` so admin code stays out of the initial bundle;
the three readers are lazy inside `ReaderPage`; and
`vite.renderer.config.ts` splits `vendor-react` / `vendor-query` chunks so the
hashed assets (served with `Cache-Control: immutable`) change less often.

### 4.2 Pages — `src/renderer/pages/`

One file per top-level route. To add a page: create it here, then wire it into
`AppShell`'s `<Routes>`.

| File | Route(s) |
| --- | --- |
| `AllPage` / `RecentPage` / `ContinuePage` | Library-wide views. `AllPage` is the home page: a `ContinueShelf` hero + up-next row above the grid. |
| `LoginPage` | `/login` — sign-in, with an inline forgot-password notice (no email reset; it points you at an admin). |
| `SettingsPage` | `/settings` — wraps `SettingsPanel`; any signed-in user. |
| `UsersPage` | `/users` — wraps `UsersPanel`; admin only (others are redirected). |
| `LibraryPage` | A single collection by id. |
| `FolderPages.tsx` | Folder + folder series/volume/chapter drill-down. |
| `BrowsePages.tsx` | Global series/volume/chapter drill-down. |
| `HierarchyPageFrame.tsx` (+ `hierarchyPageHelpers.ts`) | Shared frame for the drill-down pages. |
| `TagPage` | Tag-scoped listing. |
| `ReaderPage.tsx` (+ `readerPageHelpers.ts`) | Resolves the record, picks the lazy `ComicReader` / `EpubReader` / `PdfReader`, owns the immersive chrome + chrome-level keys (Escape/f). |
| `AuthPages.tsx` | Reset-password and verified pages. |

### 4.3 Components

| Folder | What's in it | Edit when… |
| --- | --- | --- |
| `components/layout/` | `Navbar` (search box, add-content `+` menu, identity chip with initials avatar → Settings / User management / Sign out, or a Sign in button), `NavbarThemeMenu`, `Sidebar`+`SidebarNav`, `TabBar` (mobile bottom nav: Home / Browse / Settings), `TabPanel` (the mobile Browse sheet with Collections / Folders / Tags pivots), `SortSheet`, `CommandPalette` (⌘K/Ctrl+K; `/` focuses search). | Changing chrome/navigation. |
| `components/library/` | `ComicCard` (quiet cards: humanized caption via `comicCaption`, finished items dim + check — no colored format badges), `FolderCard`, `GroupCard`, `LibraryGrid`, `ContextMenu`(+`Content`,`Dialogs`), `ContinueShelf` (home hero + up-next), `Breadcrumb`, `FilterStrips`, `SelectionBar`. | Changing how the grid/cards/menus look or behave. |
| `components/reader/` | `ComicReader`, `EpubReader`, `PdfReader`, `ReaderToolbar`, presentational `*View`/`*Controls`/`*Sheets` files, and tested rule helpers such as `comicReaderRules`, `pdfReaderRules`, `epubReaderInteractions`, `epubReaderIframeEvents`, `epubReaderLinks`, `epubRenditionTheme`. | Reader UI behavior (see `docs/READER.md`). |
| `components/admin/` | `AdminModal` — now only the four admin content actions (`upload`, `add-path`, `create-collection`, `create-folder`); auth and settings moved to real routes. Plus the panels those pages reuse: `LoginPanel`, `ForgotPasswordPanel`, `ResetPasswordPanel`, `SettingsPanel`(+`Sections`, incl. the OPDS "Connect a reader app" card), `UploadPanel`, `AddPathPanel`, `UsersPanel`. | Auth/settings/upload UI. |
| `components/ui/` | shadcn-style primitives over Radix (button, dialog, sheet, slider, select, tabs, toast…). | Reuse these before inventing new primitives. |

### 4.4 Hooks, lib, stores

| File | Responsibility |
| --- | --- |
| `hooks/useDrop.ts` | Drag-and-drop ingest path. |
| `hooks/useImmersiveChrome.ts` | Shared reader chrome: hidden on open, center-tap toggle, 3s auto-hide, hover pinning. Pure `nextChromeState` rule + tests. |
| `hooks/useComicGestures.ts` / `useComicKeyboard.ts` / `useReaderViewportControls.ts` | Reader gesture, keyboard, fullscreen, and orientation-lock handling. |
| `hooks/useInfiniteComics.ts` | Infinite-scroll paging over the library. |
| `hooks/usePullToRefresh.ts` / `useWakeLock.ts` / `useToast.ts` | Mobile/UX helpers. |
| `lib/api.ts` | **Barrel only** — re-exports `./api/index`. Keep UI imports pointed at `@/lib/api`. |
| `lib/api/client.ts` | Owns `get`/`post`/`put`/`del` fetch + error handling. |
| `lib/api/types.ts` | Renderer-facing API types. (Shared shapes go in `src/shared/apiTypes.ts`.) |
| `lib/api/{comics,folders,libraries,reading,browse,tags,admin,users,auth,settings,metadata,search,jobs}.ts` | Endpoint groups by domain. |
| `lib/catalogQueryHelpers.ts` | Shared query-key/params helpers for the catalog queries. |
| `lib/queryClient.ts` | React Query setup + `invalidateLibraryQueries`. |
| `lib/dropUtils.ts` / `lib/utils.ts` / `lib/errors.ts` | `cn` helper, `comicCaption`/`isFinished`/`progressPercentFor` caption rules, drop helpers, error types. |
| `store/readerStore.ts` | Reader prefs (zoom, direction, spread, HD, EPUB font/theme), persisted to `localStorage`. |
| `store/selectionStore.ts` | Multi-select state for bulk operations. |
| `store/uiStore.ts` | Global UI state (admin panel, mobile tab panel, sort sheet). |

> **Add a renderer API call recipe:** pick the domain module in `lib/api/` → use
> `get/post/put/del` from `client.ts` → put types in `api/types.ts` (or
> `shared/apiTypes.ts` if shared) → call it from a component through a React Query
> hook so caching/invalidation is consistent.

---

## 5. Shared — `src/shared/`

Pure modules, no DOM, no Node. Importable from both server and renderer. Most have
a colocated `.test.ts` run by Vitest.

| File | Responsibility |
| --- | --- |
| `types.ts` | Canonical `MediaRecord`, `QueryOptions`, `QueryResult`, `ScanProgress`, `NavigationState`. |
| `apiTypes.ts` | Shapes returned by the HTTP API, shared by server + renderer. |
| `mediaTypes.ts` | File-extension → `'comic' \| 'book'` mapping. |
| `naturalSort.ts` | Natural filename comparison (`page2 < page10`). |
| `coverSelection.ts` | Picks the cover entry from an archive's image list. |
| `imageFilter.ts` | `isImageFile` extension check. |
| `scaleFit.ts` | Fit-width/fit-height math for the comic reader. |
| `filterLogic.ts` | Filter-preset normalization shared by sidebar + query routes. |
| `statusFormat.ts` / `windowTitle.ts` | Small formatting helpers. |
| `lru.ts` | Byte-bounded LRU used by `archiveLoader`'s in-archive page cache. |
| `dropValidator.ts` | Drag-and-drop file-list validation. |
| `epubTheme.ts` | EPUB theme injection helpers. |

---

## 6. "I want to change X — where do I go?"

| Goal | Start here |
| --- | --- |
| Add a column / table | `db/schema/createPg.ts` (idempotent DDL) → domain file → `libraryDatabase.ts` |
| Add or change an API endpoint | `webServer/routes/<resource>.ts` (+ `routes/validation.ts`, `shared/apiTypes.ts`) |
| Change what a comic record returns to the UI | `webServer/mapping.ts` |
| Add a UI page | `pages/` + register in `components/layout/AppShell.tsx` |
| Add a UI call to the server | `lib/api/<domain>.ts` (via `client.ts`) |
| Change the library grid / cards / captions | `components/library/` + `lib/utils.ts` caption rules |
| Change the command palette | `components/layout/CommandPalette.tsx` + `commandPaletteHelpers.ts` |
| Change reader behavior | `components/reader/` + `store/readerStore.ts`; start with the relevant `*Rules.ts`/interaction helper before editing the component (see `docs/READER.md`) |
| Change reader chrome (toolbar show/hide, Escape/f) | `pages/ReaderPage.tsx` + `hooks/useImmersiveChrome.ts` |
| Change how files are imported | `ingestService.ts`; use `ingestDiscovery.ts`, `ingestPathHelpers.ts`, `ingestQueue.ts`, `seriesParser.ts`, and `archiveLoader.ts` for their specific boundaries |
| Change background jobs / auto-rescan | `jobs/` + `folderScheduler.ts` |
| Change semantic search | `search/` + `db/ebookSearch.ts` + `routes/search.ts` |
| Change OPDS / WebPub output | `routes/opds.ts` / `routes/webpub.ts` |
| Change page image rendering/caching | `imageResizer.ts` + `webServer/archiveCache.ts` (+ `upscaleClient.ts` for HD) |
| Change server startup | `main/standalone.ts` (API) or `main/worker.ts` (worker) |
| Change auth / sessions / signup policy | `webServer/auth.ts` + `webServer/routes/auth.ts` |

---

## 7. Build, run, test

| Command | What it does |
| --- | --- |
| `pnpm install --frozen-lockfile` | Install deps. |
| `pnpm dev:renderer` | Vite dev server for the SPA (proxies `/api` to a running CB8 server). |
| `pnpm build:renderer` | Build the SPA bundle into `dist/web`. |
| `pnpm build:standalone` | Build `dist/standalone.mjs` + `dist/worker.mjs` (runs `build:renderer` first). |
| `pnpm start:standalone` | Run the built API server (needs `DATABASE_URL`). |
| `pnpm test` | Vitest. Postgres-backed tests skip unless `CB8_TEST_DATABASE_URL` points at a throwaway pgvector database. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm docs:api` | TypeDoc HTML API docs into `docs/api/`. |

Before handing off: run `pnpm typecheck`, `pnpm test`, and `pnpm build:renderer`,
and mention any skipped check.

### Config knobs

- **Env vars:** `DATABASE_URL`, `CB8_DATA_DIR`, `CB8_PORT`, `CB8_HOST`,
  `CB8_INGEST_CONCURRENCY`, `CB8_SEVENZIP_PATH`, `CB8_UNRAR_PATH`,
  `CB8_ARCHIVE_LIST_TIMEOUT_MS`, `CB8_ARCHIVE_EXTRACT_TIMEOUT_MS`,
  `CB8_TRUST_PROXY_HEADERS`, `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_TRUSTED_ORIGINS`, plus the optional-service vars
  (`EMBED_URL`, `UPSCALE_URL`, …) — full reference in
  [docs/DEPLOYMENT.md](DEPLOYMENT.md).
- **Persistent settings** live in the `app_meta` table (guest access,
  auto-rescan interval, auth secret, initial admin password until changed).
- **On-disk artifacts:** `image-cache/`, `web-uploads/`, `upscale-cache/` —
  under `CB8_DATA_DIR`. Everything durable is in Postgres.

---

## 8. Conventions worth internalizing early

- **Everything is HTTP.** There is no privileged client; the SPA, the Flutter
  app, and OPDS readers all speak the same API.
- **`src/shared/` stays pure.** If you're tempted to import `fs` or touch
  `document` there, the code belongs in `main/` or `renderer/` instead.
- **The DB façade pattern:** read/write logic lives in `db/<domain>.ts`;
  `libraryDatabase.ts` just exposes it. Don't put SQL in routes.
- **Types that cross the wire live in `src/shared/apiTypes.ts`** and are imported
  by both server and renderer, so the contract can't drift.
- **Schema DDL must be idempotent.** `createPg.ts` re-runs on every boot;
  new tables/columns need `IF NOT EXISTS` guards so existing databases upgrade
  in place.
- **Heavy work goes through the job queue.** Routes enqueue; the worker
  executes. If a request handler might run for minutes, it's a job.
- **Extract testable rules.** UI timing/policy logic lives in pure helper files
  (`*Rules.ts`, `*Helpers.ts`, `nextChromeState`) with colocated tests, not
  inside components.
