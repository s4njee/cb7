# CB8 (webui) backlog

Reviewed 2026-08-14 against the current `webui/` server + SPA and cross-checked
against the joint backlog in [`reader/backlog.md`](../reader/backlog.md), which
still owns reader-side work and the shared watched-roots epic. This is a
code-based backlog for the server and web UI, not a generic feature list; the
broader checklist lives in [features.md](features.md) (mostly un-ticked, so
treat it as a wishlist — this document is the ground truth for what exists).

Effort estimates assume one developer familiar with the codebase:

- **S**: up to half a day
- **M**: one to two days
- **L**: three to five days
- **XL**: more than a week or a cross-project change

## What CB8 (webui) is today

CB8 is a Fastify API + Postgres catalog + React SPA shipped as two processes:
`standalone.ts` (API server, enqueues work) and `worker.ts` (pg-boss consumer
that drains scans/backfills). The SPA is React 18 + Vite + Tailwind + shadcn/ui,
hash-routed, with React Query for server data and Zustand for UI state. See
[ARCHITECTURE.md](ARCHITECTURE.md) before non-trivial changes.

Already in place and healthy:

- **Formats**: CBZ, CBR, EPUB, PDF end-to-end — ingest, cover extraction
  (`archiveLoader`, `epubCoverExtractor`, `pdfCoverExtractor`), and dedicated
  readers (`ComicReader`, `EpubReader`, `PdfReader`).
- **Ingest**: folder scan (recursive + incremental `since` rescan), upload /
  drag-and-drop with live per-file progress (`webServer/ingest.ts`), filename
  series/volume parsing (`seriesParser.ts`, unit-tested), classified ingest
  errors (`ingestErrorLog.ts`). Files are referenced in place, never moved.
- **Catalog**: per-user progress/favorites/history, tags, collections
  ("libraries"), folder hierarchy + series→volume→chapter drill-down, search
  (hybrid FTS + pgvector with RRF fusion, optional embeddings sidecar).
- **Discovery**: Continue-reading hero + up-next (`ContinueShelf`), command
  palette (⌘K), search box (`/`), sort/filter strips, multi-select bulk ops
  (tag / add-to-collection / delete via `selectionStore` + `SelectionBar`).
- **Metadata**: scrapers for ComicVine / AniList / MangaDex
  (`metadataScraper.ts`) wired through `/api/comics/:id/metadata-search`,
  `PUT …/metadata`, `…/refresh-metadata`, surfaced in the book context menu.
- **Compatibility**: OPDS 2 + Readium WebPub manifests, multi-user auth
  (better-auth username plugin, no public signup), optional guest access,
  trusted-origin + rate-limit hardening.
- **Deployment**: Docker, k8s, Argo CD GitOps, systemd, GPU sidecars
  (embeddings, upscale), wiki. Schema is idempotent `CREATE … IF NOT EXISTS`
  DDL (`db/schema/createPg.ts`) — no migrations table to maintain.

All P0 correctness gaps are now closed (MOBI de-support, progress
debounce/flush, covers off the `comics` row, upload lifecycle, worker
visibility). The highest-return work is the product items — watched roots,
embedded metadata + duplicate handling, batch ops — then per-user libraries,
in the order below.

## P0 — correctness and reliability

### ~~P0-1. Close the MOBI half-state — S~~

Done (2026-08-14): **de-supported.** `.mobi` dropped from `BOOK_EXTENSIONS`
(so nothing scans/ingests it) and from the drop/upload/acceptance surfaces;
legacy MOBI records keep their extension and show a clear "unsupported format"
reader state instead of attempting EPUB; README claims updated.

`src/shared/mediaTypes.ts` lists `mobi` in `BOOK_EXTENSIONS`, so
`isSupportedFile()` accepts it and ingest ingests `.mobi` files as books — but
the rest of the stack never follows through:

- `src/main/ingestService.ts` only extracts covers for `.epub` and `.pdf`
  (the `ext === '.epub'` / `ext === '.pdf'` branches) — a MOBI gets no cover.
- `src/renderer/pages/ReaderPage.tsx` only routes to Comic/Epub/PDF readers — a
  MOBI has no reader.

Net result: every `.mobi` in a scanned folder becomes a coverless, unreadable
"dead" record. Two honest ways out:

- **De-support (S).** Drop `mobi` from `BOOK_EXTENSIONS`, or keep it detectable
  but mark such records as "unsupported format" in the UI (badge + disabled
  open) and skip cover extraction. Accepts that MOBI is out of scope.
- **Real MOBI reading (L).** Add a MOBI parser to `ingestService` (cover + page
  count) and a reflowable reader path, mirroring how EPUB is handled.

Either is fine; the current silent half-state is not. Also re-check the
README/features claim "Reads … .mobi" — it is only true if the L option lands.

### ~~P0-2. Debounce and flush reading progress — S~~

Done (2026-08-14): `src/renderer/lib/progressSync.ts` — trailing 800 ms
debounce, latest-position-wins per book, explicit flush on reader unmount plus
`pagehide`/`visibilitychange` global safety nets. Wired into Comic/Epub/Pdf
readers; 7 fake-timer unit tests.

All three readers write progress on every page relocation through
`src/renderer/lib/api/reading.ts` (`putProgress`), each an HTTP round-trip plus
a Postgres write. On fast paging this is a burst of writes per second.

Add a shared trailing debounce (≈750–1000 ms) with an explicit flush when the
reader unmounts or the tab hides/backgrounds, keeping the latest value per
book and making writes monotonic within a session. The reader backlog flags the
same issue for the Tauri client (different mechanism — disk `catalog.json`
rewrites there, network + DB here); a shared JS helper would serve both.

Expected result: orders of magnitude fewer requests/writes during fast paging,
no lost final position. Add fake-timer tests for burst collapsing and flush on
unload/background.

### ~~P0-3. Move covers off the `comics` row — M~~

Done (2026-08-14): `comic_covers` table is now the source of truth. Ingest and
metadata/cover writes go there; list, library, and folder cover queries read it
with a legacy-column fallback; the worker backfills old blobs at startup and
NULLs the column — the UPDATE guards on `cover_thumbnail IS NOT NULL` so a
re-run no-ops, and `updateCoverThumbnailByPath` was repointed at the new table
(path-based callers unchanged). 9 Postgres-gated tests in
`db/comics.covers.test.ts` cover write/read/migration/
cascade (addComic/addComicFast → comic_covers, list `has_thumbnail`/version,
folder covers, backfill idempotency, cascade delete).

`cover_thumbnail` is `BYTEA` on the main table. The code is already disciplined
about not selecting it on hot paths (`COMIC_NO_BLOB_COLUMNS`, `getComicLite`,
lazy `/api/comics/:id/thumbnail`), but the blob still sits in the row:
it bloats the table and backups, slows full scans, and mixes one kind of blob
in with structured metadata.

Move covers to a separate `comic_covers(comic_id, data, updated_at)` table (or
disk under `CB8_DATA_DIR` with a generated URL), keep the column as a legacy
read fallback, and add a worker `cover-backfill` job. Follow the schema recipe:
idempotent DDL in `createPg.ts` → domain function → `libraryDatabase` method →
Postgres-gated test.

### ~~P0-4. Confirm and finish upload lifecycle — S~~

Done (2026-08-14): confirmed uploads were never cleaned up. Added a `source`
column (`'scan'` / `'upload'`); removing an upload-sourced record now also
deletes its file (scanned files stay untouched, and uploads no longer leave a
`dismissed_paths` marker that would block re-upload); the worker GC-sweeps
orphaned `web-uploads/` hourly-old files on a 6 h interval.

`src/main/webServer/routes/upload.ts` unlinks the staged file on failure paths,
but the success path ingests into the catalog and the archive stays under
`web-uploads/`. Confirm whether successful uploads are cleaned up; if not, add
post-ingest deletion (keep the catalog row — it references the original path in
the user's library, and uploaded archives are already copied into
`CB8_DATA_DIR`). A periodic GC for orphaned `web-uploads/` entries is a cheap
safety net.

### ~~P0-5. Hardened job and worker visibility — M~~

Done (2026-08-14): the worker writes a 30 s heartbeat to `app_meta`;
`GET /api/jobs` returns `{ jobs, worker: { alive, lastSeenAt }, queue }`
(depth + per-queue counts from `pgboss.job`). New `WorkerStatusSection` in
Settings and a worker-down warning banner in the Add-path panel, both polling
every 15 s.

`GET /api/jobs` surfaces scan jobs, but there is no first-class view of worker
health (last heartbeat / queue depth / stuck jobs). Add a worker heartbeat row
updated by `worker.ts`, expose it with queue depth and per-queue counts in
`/api/jobs`, and let the admin UI show "worker is down — scans are queued, not
running" instead of a silently idle spinner. This is the operational face of the
architecture's core rule: *the API only enqueues*.

## P1 — high-value product work

### P1-1. Per-user library access — L

Today every user sees the whole catalog; there is no concept of per-user
libraries (confirmed: `db/libraries.ts` / `db/users.ts` have no membership).
For a multi-user self-hosted server this is the biggest missing isolation
feature.

Add `library_members` (user, library, role) with a default "everyone" semantics
that administrators can restrict. Filter `queryComicsForUser` and the
folder/hierarchy/browse queries by membership, gate admin actions, and surface
membership in the Collections admin UI. This is schema + query-wide, so it is
the kind of change that needs the Postgres-gated test suite run first.

### P1-2. Batch operations completion — M

`selectionStore` + `SelectionBar` already do tag / add-to-collection / delete.
Extend the same affordance to the operations that today are per-book only:

- **Mark read / unread** (currently absent in the webui entirely).
- **Batch metadata edit** (author / series / volume / year / tags / summary).
- **Select-all-matching-filter** and persistence of selection across the
  infinite grid pages.
- **Batch cover/thumbnail refresh** and a **custom cover override** (also
  absent today) — a `PUT /api/comics/:id/cover` plus a picker in the metadata
  dialog, or drag an image onto the cover.

### P1-3. Embedded metadata extraction at ingest — M

`ingestService` derives series/volume from the filename (`seriesParser.ts`,
excellent and unit-tested) but never reads embedded metadata. Parse
`ComicInfo.xml` for CBZ/CBR and the OPF package for EPUB, then fill title,
author, series, volume/issue, language, tags, date, and summary on the catalog
row. The metadata edit dialog and `metadata-search` already exist, so this is a
feeding-the-existing-pipeline change, not new surface.

### ~~P1-4. Duplicate detection — M~~

Done (2026-08-14):
- **Hash at ingest**: `fileHasher.ts` streams SHA-256 per new file in
  `prepareInsert`, before any cover/page work; a byte-identical copy elsewhere
  in the catalog is rejected early (`comicExistsByHash`). Hash stored on the
  `comics.content_hash` column (indexed) so rescans short-circuit.
- **Reporting**: scans count rejected duplicates end-to-end — `IngestScanResult`,
  `scan_jobs.duplicates`, the NDJSON `done` event, and the Add-path toast
  ("N duplicates skipped"); a duplicate upload drops its redundant file and
  reports `duplicate: true`.
- **Review surface**: `GET /api/admin/duplicates` + a `DuplicatesSection` in
  Settings listing exact (same hash) and likely (same series+volume) groups with
  a per-record Remove action.
- 2 unit tests (`fileHasher`) + 5 Postgres-gated tests (addFile dedupe,
  `comicExistsByHash`, `findDuplicateGroups`, admin route).

Note: legacy rows predating hashing have `content_hash NULL` — only exact
groups among newly-ingested files are detected until a future hash backfill.

### P1-5. CB7 and plain image folders — L

`COMIC_EXTENSIONS` is only `{cbz, cbr}`. CBR already goes through 7-Zip
(`node-7z`), so CB7 (7z) support is mostly detection + extension: add `cb7` to
`mediaTypes.ts` and verify the 7z path extracts page images. A plain-image-folder
"comic" (JPG/PNG/WEBP/AVIF in a directory) is a larger change: a new ingest
media type, natural-sort page ordering (exists in `naturalSort.ts`), and the
comic reader path already handles numbered images, so it is mostly ingest +
modeling.

### ~~P1-6. OPDS depth — M~~

Done (2026-08-14): `routes/opds.ts` rebuilt into a real OPDS 2 catalog.
- **Authenticated OPDS**: HTTP Basic auth resolved in `dispatchApi`
  (`webServer/basicAuth.ts`) against the same users table, so external reader
  apps sign in with username/password; invalid creds get a `WWW-Authenticate`
  challenge. The guest gate still applies to anonymous access.
- **Root navigation feed** (`/api/opds`) linking to All / Continue / Recently
  read, every collection, and OpenSearch — with the continue-reading subset
  inline so a client that only fetches the root gets content.
- **Paged catalog feeds** (`/api/opds/all`, `/continue`, `/recent`,
  `/library/:id`) with `numberOfItems`/`itemsPerPage`/`currentPage` + `next`.
- **Progress feed**: publications carry `percentRead`, `lastPage`,
  `lastLocation`, `lastReadAt` so apps resume where the user left off.
- **OPDS search**: OpenSearch description (`/opds/search/opensearch.xml`) +
  `GET /opds/search?q=` metadata search.
- Feed builders are pure (`routes/opdsFeedHelpers.ts`); 18 unit tests + 11
  Postgres-gated route tests.

### P1-7. Reading statistics — S

`/api/history` records what was read, but nothing aggregates it. Add
pages-read / reading-session totals per user, book, and time window (a handful
of SQL queries over `history`), and surface a light "reading stats" section
(pages read, top authors, current streak) in settings or on the home page. The
Tauri reader already has a local stats view; this gives the server the same
picture across all clients.

## P2 — platform and product completeness

- **~~P2-1. Backup / restore from the admin UI — M.~~** Done (2026-08-14):
  `GET /api/admin/backup` streams a `pg_dump` SQL backup (`webServer/pgBackup.ts`,
  `--no-owner --clean --if-exists`) as a download, with a **Download backup**
  button in Settings. Restore is deliberately a host operation (documented in
  the section copy: stop both processes, `psql -f backup.sql "$DATABASE_URL"`)
  because restoring into the live DB the API is connected to isn't safe as a web
  action. The scheduled-backup option is not included.
- **~~P2-2. Cache controls — S.~~** Done (2026-08-14): `getCacheStats()` /
  `clearImageCaches()` in `imageResizer.ts` (both on-disk caches), surfaced via
  `GET/DELETE /api/admin/cache` and a **Caches** section in Settings showing
  per-cache file counts + sizes with a Clear action.
- **~~P2-3. Server version + update awareness — S.~~** Done (2026-08-14):
  `GET /api/settings/version` (`serverVersion()` reads `package.json`) + a
  **Server** section in Settings showing the CB8 version. Registry/update
  comparison is not included.
- **P2-4. Jobs / errors / worker-health admin surface — M.** Partly done via
  P0-5 (worker heartbeat + queue depth in `GET /api/jobs`, `WorkerStatusSection`).
  Remaining: fold scan-progress polling and `AddPathFailureReport` into one
  "Library jobs & errors" view.
- **~~P2-5. Store-ready CI — L.~~** Done (2026-08-14): `.github/workflows/ci.yml`
  — on push/PR touching `webui/**`, two jobs: (1) `pnpm install --frozen-lockfile`
  → typecheck → unit tests → `build:renderer` → `build:standalone`; (2) the
  Postgres-gated suite against a `pgvector/pgvector:pg16` service container
  (`CB8_TEST_DATABASE_URL`, `--no-file-parallelism`). `pnpm-workspace.yaml`
  already allows esbuild's install script so the server bundle builds.
- **P2-6. Accessibility pass — L.** Not started — needs a running app + browser
  to verify meaningfully; keyboard coverage is largely present via ⌘K and
  reader shortcuts.

## P3 — UI/UX polish

- **~~P3-1. First-run admin onboarding — S.~~** Done (2026-08-14): an empty
  library now shows a proper onboarding panel on the home page — admins get
  **Add a folder** (opens the Add-path admin panel), **Upload files** (opens the
  upload panel), and **Enable guest access** (Settings); non-admins get "ask an
  admin". The AdminModal's open state moved into `uiStore` (`openAdminPanel`)
  so the home page can drive it.
- **~~P3-2. Empty and no-result states — S.~~** Done (2026-08-14): three
  distinct states via a new `EmptyState` component + `emptyContent` on the grid —
  empty library (onboarding above), filtered-search with no matches (**Clear
  filters** / **Clear search** actions), and the search view's "no series match"
  — no more one italic line for everything.
- **P3-3. Search UX refinements — M.** Not started. Result counts already exist
  in the search header; debounce/removable filter chips are the remaining work.
- **~~P3-4. List view + cover density — M.~~** Done (2026-08-14): a grid/list
  toggle in the filter bar. List mode renders compact rows (small cover, title,
  status, progress) for comics and folders/series; density (`compact` /
  `comfortable`) tightens grid columns or row height. `viewMode`/`density`
  persist per device class (phone vs desktop) in `uiStore` via localStorage.
- **P3-5. WebUI mobile pass — M.** Not started.

## Epic — Watched library roots (drop-folder ingest) — L overall

> Canonical, full version in [`reader/backlog.md`](../reader/backlog.md) —
> the primary work is all in `webui/`. Kept in sync here in condensed form.

**Problem.** Adding books from a server path is a one-shot "browse and scan"
(`POST /api/admin/add-path`). After that you can rescan (`POST
/api/folders/:id/rescan`) and a global `auto_rescan_interval_min` drives
`folderScheduler`, but there is no durable "this path is watched" model:
rescan derives the path from already-ingested files (an empty or brand-new drop
root can't be rescanned), and the interval is one obscure global toggle rather
than a first-class watched-roots list.

**Goal.** Treat library paths as durable watched roots: register once (or
promote an existing folder), scan on a configurable interval, and always offer
a one-click **Rescan** that reuses the stored path.

**Done (2026-08-14):** `folders.scan_path` + `auto_scan_enabled` columns; add-path
registers a root when a folder label is given; `GET/PUT/DELETE /api/roots` +
`/api/roots/rescan-all` admin endpoints; folder rescan prefers the stored root
and reports a missing path instead of enqueueing a doomed job; the scheduler
walks only enabled roots; Settings gained a `WatchedRootsSection` (roots list,
per-root Rescan / enable / edit-path / remove, "Add watched folder" reusing the
add-path picker, interval presets, offline badge). Postgres-gated tests in
`db/folders.roots.test.ts`.

**Build on existing scaffolding (do not reinvent):** `folderScheduler.ts`,
`POST /api/folders/:id/rescan` + incremental `folder_scan_ts:*` cursors,
`GET/PUT /api/settings/auto-rescan-interval`, worker `ingest-scan` jobs
(`jobs/queues.ts`, `producer.ts`, `handlers.ts`), and the `AutoRescanSection`
in the admin settings panel.

**Stories** (from `reader/backlog.md`):

1. ~~**Persist an explicit scan root per watched folder — M.**~~ Done:
   `folders.scan_path` (+`auto_scan_enabled`); add-path writes it; empty roots
   are valid watch targets; never required for virtual folders.
2. ~~**One-click Rescan without re-browsing — S.**~~ Done: Rescan per root +
   `POST /api/roots/rescan-all`; prefers the stored `scanPath`, falls back to
   common-dir only for legacy folders; job status in the roots list.
3. ~~**Interval clarity — S.**~~ Done: Settings copy says *watched folders*,
   presets (Off / 5 / 15 / 60 min, "0 = manual only"); scheduler walks only
   enabled roots.
4. ~~**Watched-roots admin surface — M.**~~ Done: `WatchedRootsSection` in
   Settings — Path / Folder / Interval / Last scan / Status / Actions (Rescan,
   enable/disable, edit path, remove) + "Add watched folder" reusing the
   add-path picker; missing mounts show an offline badge.
5. ~~**Incremental scan correctness — M.**~~ Done (mostly existing, verified +
   documented): new files picked up, unchanged skipped (`since` cursor +
   `comicExistsByPath`), removed files leave catalog rows (never crash), scans
   single-flight via queue singleton keys, progress/last-error visible.
6. ~~**Ops/docs — S.**~~ Done: README updated (register vs one-shot, interval,
   worker requirement); wiki/AGENTS notes deferred to the canonical
   reader/backlog.md.

Delivery order: 1 → 2 → 3 → 4 → 5 → 6. Prefer extending `folderScheduler` over a
new FS watcher; realtime inotify/FSEvents can be a later epic if interval +
Rescan isn't enough.

## Suggested delivery order

1. ~~P0-1 (MOBI de-support) + P0-2 (progress debounce/flush) — quick wins.~~ Done 2026-08-14.
2. ~~P0-4 (upload lifecycle) + P0-5 (worker heartbeat/visibility).~~ Done 2026-08-14.
3. ~~P0-3 (covers table + backfill).~~ Done 2026-08-14.
4. Watched-roots stories 1–2 (immediate admin value).
5. P1-3 (embedded metadata) + P1-4 (duplicate detection).
6. P1-2 (batch ops: mark read, batch metadata, custom covers).
7. P1-1 (per-user libraries) — the big one, schedule after the above stabilize.
8. P2-5, P2-1, P2-2 (CI, backup/restore, cache controls) — operational
   completeness.
