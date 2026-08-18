# CB8 (server) backlog v2 — remaining work

Reviewed 2026-08-14 against the current `server/` server + SPA. This document
**only lists work that is not yet implemented**. The historical record of what
shipped (and how) lives in [`backlog.md`](backlog.md). Reader-side remaining
work still lives in [`reader/backlog.md`](../reader/backlog.md). The generic
checklist in [`features.md`](features.md) is a wishlist — many boxes there are
stale (unticked even when the feature exists). This file is the ground truth
for what is left.

Effort estimates assume one developer familiar with the codebase:

- **S**: up to half a day
- **M**: one to two days
- **L**: three to five days
- **XL**: more than a week or a cross-project change

## What already exists (do not rebuild)

CB8 is a Fastify API + Postgres catalog + React SPA, two processes
(`standalone.ts` enqueues, `worker.ts` drains). See
[ARCHITECTURE.md](ARCHITECTURE.md).

Already in place and healthy — treat these as the foundation, not as gaps:

- Formats: CBZ, CBR, EPUB, PDF end-to-end. MOBI is **de-supported** (legacy
  rows stay, reader shows "unsupported format").
- Ingest: folder scan + incremental `since` rescan, upload / drag-and-drop,
  filename series/volume parsing, classified ingest errors, files referenced
  in place.
- Catalog: per-user progress / favorites / history / bookmarks-with-notes,
  tags, collections, folder hierarchy, hybrid FTS + pgvector search.
- Discovery: Continue-reading hero, command palette, search box, sort /
  filter strips (media type, read status, favorites), grid/list + density
  store, multi-select (tag / collection / folder / delete).
- Metadata: ComicVine / AniList / MangaDex scrapers + per-book apply /
  `PUT …/metadata`.
- Compatibility: OPDS 2 + Readium WebPub, better-auth (no public signup),
  optional guest **read** access, Basic-auth OPDS.
- Ops: watched roots, worker heartbeat + queue depth, `pg_dump` download,
  cache stats/clear, server version, GitHub CI (unit + Postgres-gated).
- Reliability closed in v1: progress debounce/flush, covers off the `comics`
  row, upload lifecycle + GC, exact-hash duplicate detection at ingest.

All P0 correctness gaps from v1 are closed. The highest-return remaining
work is **isolation** (per-user libraries), **feeding the catalog from the
files themselves** (embedded metadata + hash backfill), and **finishing the
batch / cover / missing-file surfaces** that the UI already half-implies.

## Deliberate non-goals

Do not "fix" these unless the product decision changes. They look like
missing features and are not:

| Apparent gap | Why it is not a backlog item |
| --- | --- |
| Public signup | Sign-up endpoints 403; admins create accounts. |
| Guest progress / writes | Anonymous access is read-only; 401 on PUT is by design (`canAccessApiRequest`). Dead write logic in `progress.ts` must stay gated. |
| Restore-from-backup in the UI | Restoring into the live DB the API is connected to is unsafe. Host operation: stop both processes, `psql -f backup.sql`. |
| MOBI / AZW3 reading | De-supported. Do not re-add `.mobi` to `BOOK_EXTENSIONS`. |
| In-place format conversion | Product rule: never move, rename, or rewrite the user's files. |
| Real email / forgot-password mail | Users are `username@localhost`; `emailSender.ts` logs to stdout. Login copy says "ask an admin." |

---

## P1 — high-value product work

### ~~P1-1. Per-user library access — L~~

Done (2026-08-14).

- **Schema**: `libraries.everyone BOOLEAN NOT NULL DEFAULT true` +
  `library_members(user_id, library_id, role)` — existing installs default to
  "everyone" so a deploy is never a lockout.
- **Filtering** (`db/libraryAccess.ts`, shared conditions): a comic is visible
  when it's in a public library, a library the user is a member of, or no
  library (uncollected → public); a library is visible when public or the user
  is a member; guests see public + uncollected; admins skip the filter.
  Applied to `queryComicsForUser`, `buildHierarchyScope` (all browse/volume/
  chapter groups), `getAllLibraries`, `queryComicsByLibrary`, the guest + per-user
  continue/recent shelves, `/api/series` + series comics, folder comics, and
  search-inside (`ftsCandidates`/`vectorCandidates`).
- **Open is 404, not a leak**: `requireComic`/`requireComicLite` + the single
  comic route check `isComicVisible`, so a restricted book 404s everywhere it's
  opened (pages, manifest, file, progress). The restricted collection page 404s
  for non-members too. OPDS inherits the same ACL.
- **Admin surface**: `GET/PUT /api/libraries/:id/access`
  (`setLibraryAccess`/`getLibraryMemberIds`, `requireAdmin`) + an **Access**
  button on the collection header opening `LibraryAccessDialog` (Everyone switch
  + member checkboxes). Also fixed the collection header's edit buttons to be
  admin-gated (`canEdit={isAdmin && …}`).
- **Tests**: `db/libraryAccess.test.ts` — 8 Postgres-gated cases covering the
  acceptance contract (A can't list/open B-only books → 404; members and admins
  can; guests see public only; admin read/set access, non-admin 403).

Acceptance met: two users, two collections — user A cannot list or open B-only
books (404), user B and admin can. Guests see public libraries + uncollected.

### P1-2. Finish batch operations — M

`selectionStore` + `SelectionBar` already do add-to-collection / add-to-folder
/ delete. Context menu already does **Mark Read** / **Mark Unread**
(`api.setCompleted` / `api.clearProgress`) on the current selection — the
v1 backlog was stale on this. Remaining:

- **Promote mark read / unread onto `SelectionBar`** so bulk status does
  not hide behind a right-click. Same two API calls; no new route.
- **Batch metadata edit.** `PUT /api/comics/:id/metadata` and
  `buildComicMetadataUpdate` already accept a partial field set. Add
  `PUT /api/comics/batch-metadata` (or loop the existing PUT from a dialog)
  for author / series / volume / year / tags / summary. Only write fields
  the user set; leave others untouched (same `undefined` vs `null` rule as
  `comicMetadataHelpers.ts`). Context-menu apply today targets
  `targetComic.id` only.
- **Select all matching this filter.** `selectionStore.setSelection` exists
  and is never called. Need a server helper that returns matching ids for
  the current query (limit-capped, e.g. 2 000) so unloaded infinite-grid
  pages can be selected. Persist the id set as today; do not try to
  checkbox virtual rows that are not mounted.
- **Batch cover / thumbnail refresh.** `POST /api/comics/:id/refresh-metadata`
  is one book and a no-op for comics. Add a worker job that re-extracts
  covers for a list of ids (or "all missing") and writes `comic_covers`.

Acceptance: filter Unread → Select all → Mark read clears the filter;
multi-select → set author "X" does not clobber series; refresh covers
updates `has_thumbnail` without re-ingesting files.

### P1-3. Embedded metadata at ingest — M

`ingestService` derives series / volume / title from the filename
(`seriesParser.ts`, unit-tested) and never reads the file. EPUB OPF is
walked only for **cover + spine page count** (`epubCoverExtractor.ts`).
There is no ComicInfo.xml parser.

Parse, in this order of precedence (file beats filename, user edit beats
both):

1. **CBZ/CBR** — `ComicInfo.xml` (and ComicInfo.json if present): Title,
   Series, Number / Volume, Writer / Penciller, Genre, Year, Language,
   Summary, PageCount.
2. **EPUB** — OPF `dc:title` / `dc:creator` / `dc:language` / `dc:date` /
   `dc:description` / subjects as tags. `search/epubText.ts` already
   regexes `dc:title` for chunk labels; reuse a small shared OPF reader.
3. Filename parser as fallback for anything still empty.

Schema today has `author`, `artist`, `genre`, `year`, `summary`,
`series_name`, `volume_number`, `chapter_number` — no `language` or
`publisher`. Add those two columns (`ALTER TABLE … ADD COLUMN IF NOT
EXISTS`) if we persist them; do not stuff language into `genre`.

Do not overwrite fields a user has already edited (track a
`metadata_source` or only fill nulls). Wire the same parser into a
"Re-read embedded metadata" action on the existing metadata dialog.

Acceptance: drop a ComicInfo-tagged CBZ and an OPF-tagged EPUB; catalog
row has author / series / volume / summary without a scrape. Filename-only
archives still get the current parser.

### P1-4. Content-hash backfill — S

Duplicate detection hashes **new** files only (`fileHasher.ts` in
`prepareInsert`). Legacy rows keep `content_hash NULL`
(`createPg.ts` comment). Exact groups therefore miss anything ingested
before P1-4 shipped.

Add a worker job (same shape as the cover backfill in `worker.ts`): walk
`WHERE content_hash IS NULL`, stream SHA-256, write the column, skip
unreadable files and log them. Idempotent: a re-run is a no-op once every
row is hashed. Surface a one-shot "Hash existing files" in the existing
Duplicates Settings section, or just run it on worker boot like covers.

Acceptance: two pre-hash copies of the same bytes become an exact group
in `GET /api/admin/duplicates` after the job. Re-run does not re-read
already-hashed files.

### P1-5. Custom cover override — S

Covers change today only when scraped metadata supplies a `coverUrl`.
There is no `PUT /api/comics/:id/cover`, no file upload, no drag-onto-cover.

Add:

- `PUT /api/comics/:id/cover` (authenticated; admin-or-owner — start with
  admin) accepting `image/jpeg|png|webp`, writing `comic_covers` via the
  existing `setComicCover`.
- A picker on the metadata dialog, plus drag-an-image onto the cover in
  the dialog (not the grid card — that fights multi-select).
- Optional `DELETE` to revert to the extracted archive cover (re-run the
  existing extractor).

Keep list queries off the blob (`COMIC_NO_BLOB_COLUMNS`). Bump the
thumbnail cache-buster (`dateAdded` is the current `?v=`; prefer
`comic_covers.updated_at`).

Acceptance: upload a JPEG, grid and reader chrome show it; revert
restores the archive cover.

### P1-6. CB7 and plain-image folders — L

`COMIC_EXTENSIONS` is `{cbz, cbr}`. CBR already falls through 7-Zip
(`archiveLoader.ts` / `node-7z`), so **CB7** is mostly detection:

- Add `cb7` to `mediaTypes.ts`, `EXTENSION_LABELS`, drop/upload accept
  lists, and the archive handle union.
- Verify the existing 7z path extracts page images and a cover. Add a
  fixture test next to `archiveLoader` / `archiveEntryHelpers`.

**Plain image folders** (JPG / PNG / WEBP / AVIF in a directory as one
"comic") is the larger half:

- New ingest media kind, or a synthetic archive whose "entries" are the
  directory listing. Natural-sort already exists (`naturalSort.ts`).
- The comic reader already consumes numbered page URLs — ingest +
  `page_count` + a page-serving path that reads files from the folder
  instead of a zip is the work.
- Do not ingest a watched root of loose images as thousands of one-page
  "comics." A folder becomes one record when it contains images and no
  supported archive, or when the admin opts in ("this folder is a
  chapter").

Acceptance: a `.cb7` opens in `ComicReader`; a folder of `01.jpg`…`12.jpg`
is one 12-page book; a folder that also contains `.cbz` files is still a
scan root, not one book.

### P1-7. Reading statistics — S

`/api/history` is a paged log (`db/history.ts`); `getHistory` is unused by
any page. Nothing aggregates it.

Add a handful of SQL queries over `reading_history` + `user_progress`:

- pages / sessions in the last 7 / 30 / 365 days
- current streak (consecutive days with a `read` / `open` action)
- top authors / series for this user

Expose `GET /api/stats` (authenticated, this-user only) and a light
"Reading" section on the home page or in Settings: pages this week, streak,
top author. The Tauri reader already has a local stats view; this is the
server-wide picture.

Do not add a new table until the log is proven too thin (it has
`action` + `page` + `timestamp` — enough for v1).

Acceptance: read 3 books across 2 days; stats show non-zero pages and a
streak of 2. Guests get 401 (same as other writes / personal state).

### P1-8. Missing-file handling and path remap — M

When a scanned file disappears, the catalog row stays and page/file
routes 500 (`routes/comics.ts`). Incremental scan is correct not to
delete (files are referenced in place) but the library has no "this file
is gone" state. Watched **roots** already show an offline badge;
individual comics do not.

- On scan (and optionally on first 404/ENOENT of a page request), mark
  `comics.missing_at` (nullable timestamptz). Clear it when the path
  exists again.
- Badge + filter ("Missing") in the grid / list row. Opening a missing
  book shows a dedicated empty state, not a generic 500.
- Admin actions: **Remove from catalog** (already exists), **Locate…**
  (`PUT /api/comics/:id/path` to a new absolute path the worker can see,
  re-hash, clear `missing_at`). Do not move the file.
- Policy for "prune all missing" as an explicit admin button, never
  automatic.

Acceptance: rename a CBZ on disk, rescan → row is badged Missing and
opens cleanly; Locate to the new path restores reading. Delete-from-disk
+ prune removes only the row.

---

## P2 — platform and product completeness

### ~~P2-1. Unified library jobs & errors view — M~~

Done (2026-08-14). New `JobsAndErrorsSection` in Settings (replaces the old
`WorkerStatusSection`, which it subsumes) folds in, on one 15 s poll:

- **Worker** alive/last-seen + queue depth per queue (`GET /api/jobs`).
- **In-flight jobs** — target-path basename, status, processed/discovered.
- **Persistent ingest errors** (`GET/DELETE /api/admin/ingest-errors`, previously
  an API with no panel): count, per-class filter pills (`ingestFailureLabel`),
  clear-log, and per-row **copy path** (the "jump" — server paths aren't
  navigable in the SPA, so the operator copies the failing path).

Add-path keeps its live progress + failure report and its worker-down banner;
nothing moves mid-scan. Acceptance met: a failed CBR is visible under Settings
without re-running add-path.

### P2-2. Accessibility pass — L

Keyboard coverage is largely present (⌘K, `/`, reader shortcuts,
`aria-pressed` on filter pills). This is not a pass. Needs a running app
and a browser (or VoiceOver) — do not tick this from code review alone.

**Progress (2026-08-14)** — code-level items landed but NOT verified in a
browser/VoiceOver; the acceptance below still needs a real run:
- Skip link (`#main-content`) + `<main>` landmark in `AppShell`.
- Comic cards / list rows are now `role="link"` with `aria-label`
  ("Title, 34% read") + Enter/Space activation; select checkboxes have
  accessible names; view-toggle buttons have `aria-label` (not just
  `title`).
- `prefers-reduced-motion: reduce` collapses page-slide / zoom / cue /
  spinner animation app-wide (`globals.css`).
- `prefers-contrast: more` brightens text + border tokens on top of the
  Folio theme set.
- `density` is now exposed as a Compact / Comfortable control in the
  filter bar (also closes v2 P3-2's density half).

Remaining (needs a live run): skip-link/focus-order trip, remaining
icon-only labels (toolbar buttons, nav), high-contrast review against the
reader, and the VoiceOver/TalkBack card-title check.

Acceptance: keyboard-only trip from login → open a comic → next page →
back → mark favorite. VoiceOver/TalkBack announces card titles, not
"image".

### P2-3. Scheduled catalog backups — M

`GET /api/admin/backup` streams a `pg_dump` on demand. There is no cron.

Add an optional worker interval (off / daily / weekly) writing a rotating
set of dump files under `CB8_DATA_DIR/backups/` (keep N). Reuse
`pgBackup.ts` rather than a second dump path. Restore stays a host
operation.

Acceptance: interval 1 day, a file appears under the backups dir after
the first tick; Settings shows last-backup time + download of that file.

### P2-4. Update awareness — S

`GET /api/settings/version` + Settings **Server** already show the
running version from `package.json`. Missing: compare to a configured
registry / GitHub release and show "update available."

Keep it fail-soft (same rule as `EMBED_URL` / `UPSCALE_URL`): no network
or a 404 is "unknown," not an error banner. Do not auto-update a
self-hosted server.

### P2-5. Per-root scan interval — S

Watched roots are shipped. Interval is one global
`auto_rescan_interval_min`; each root can only enable/disable. Optional
`folders.scan_interval_min` override (null = use global) and a minutes
field on `WatchedRootsSection`. Scheduler already walks enabled roots —
read the override there.

### P2-6. OCR comic-page index — XL

`QUEUE.ocrIndex` + `OcrIndexJob` exist in `jobs/queues.ts` and the queue
is created in `boss.ts`. There is no producer and no `boss.work` handler.
`worker.ts` only drains `ingest-scan` and `search-backfill`.

Intended design (already documented on the payload): OCR each page,
chunk → embed → upsert into `ebook_chunks` so `searchInside` works for
comics the way it works for EPUBs. Checkpoint per page so a restart
resumes. Optional sidecar (fail soft when unset).

Do this after P1-3 (embedded metadata) and only if semantic search is
actually deployed (`EMBED_URL`). Otherwise the job writes nothing useful.

### P2-7. Annotations API (server half of reader ink / highlights) — L

The SPA has bookmarks with an optional `note` (`db/bookmarks.ts`). It
does not have text highlights, freehand strokes, or a sync API. The
Tauri reader already wants this (see `reader/backlog.md` "Complete
annotation basics" + the Apple Pencil epic).

When it ships, the **server** contract should exist first so web + Flutter
+ Tauri do not invent three stores:

- `annotations(id uuid, user_id, comic_id, kind, page, cfi_range, color,
  payload jsonb, created_at, updated_at, deleted_at, revision)`
- Versioned REST: list-since-rev, upsert (client UUID, idempotent),
  tombstone delete. Cascade on user / comic delete. Never write into
  the book file.
- Payload/point-count limits. Authenticated only (not guests).

The web SPA can start with EPUB range highlights + notes; ink is a
reader-client problem that consumes the same table.

### P2-8. Realtime watched-root notifications — L (later epic)

Interval + Rescan is enough for drop folders. If large incoming volumes
make polling feel slow, add inotify / FSEvents (or a `watchdog` sidecar)
that enqueues the existing `ingest-scan` with the current `since`
cursor. Do not invent a second ingest path. Prefer this after P2-5
(per-root interval) so operators can already go faster without kernel
watches.

### P2-9. Ops leftovers — S

Small, easy to forget:

- Wiki + `packaging/wiki/content/formats.md` still mention `.mobi` as a
  book format. Align with the de-support.
- `AGENTS.md` / wiki ops: watched-root vs one-shot add-path (README is
  done; wiki/AGENTS were deferred).
- Stale comments: `dropValidator.ts` still says ".mobi"; `AppShell`
  still documents a Sidebar / TabBar that are gone.
- `authRoutes.test.ts` still carries a SQLite-era skip TODO — either
  port the suite onto `pgTestDb` or delete the file so it stops lying.

---

## P3 — UI/UX and reader completeness

### ~~P3-1. Search and filter chips — S~~

Debounce (300 ms header, 200 ms palette) and result counts ("Found N
series," "Inside your books (N)") already exist. Remaining:

- ~~Removable chips for every active filter (media type, read status,
  favorites, search term, and the unused `fileExt`).~~ Done (2026-08-14):
  `ActiveFilterChips` renders a dismissable chip per active filter plus a
  **Reset** (the existing `resetFilters`), shown in both the standard grid and
  the search view on the home page.
- ~~**Format filter UI.**~~ Done (2026-08-14): `fileExt` pills — All / CBZ /
  CBR / EPUB / PDF — added to `FilterStrips` (`setFileExt`); it already flowed
  through `comicQueryOptionsFromFilters` → the grid query, so it filters now.
- ~~One "Reset view" that is the existing `resetFilters` plus chips.~~ Done:
  the Reset chip clears every active filter including search.

Acceptance met: apply Unread + EPUB + search → three chips; dismiss EPUB →
grid re-queries (results update); Reset clears all.

### ~~P3-2. Density control + recently-added shelf — S~~

Done (2026-08-14):
- **Density control** landed during the P2-2 accessibility pass: a Compact /
  Comfortable toggle next to the grid/list switch (`uiStore.density`).
- **Recently added shelf** — new `RecentlyAddedShelf` on the home page (compact
  horizontal cover row, `GET /api/recently-added` = newest first by `dateAdded`,
  per-user visibility) plus the sort dropdown's `dateAdded` label renamed
  "Recent" → **"Recently added"**, so "new on disk" and "I just read this"
  no longer share a word. (No `/added` route/OPDS feed — the shelf + label
  rename was the chosen option.)

### P3-3. WebUI mobile pass — M

Not a green field: FolioHeader splits desktop/mobile, `100dvh` +
safe-area, PWA manifest, comic pinch/swipe, pull-to-refresh. What is
missing is a dedicated pass.

**Progress (2026-08-14)** — code-level fixes landed, NOT verified in a phone
viewport (the walkthrough below needs a live run):
- ~~Selection bar vs iOS home-indicator overlap~~: `bottom-18` (a guess)
  replaced with `bottom-[calc(3.5rem+env(safe-area-inset-bottom))]` on mobile
  (clears the TabBar + home indicator), `md:bottom-6` on desktop.
- ~~Filter strips on 320 px~~: the header row and the sort/view/density
  controls now `flex-wrap`; the pills row already scrolls horizontally.
- ~~Reader chrome tap targets~~: `.reader-tool-btn` bumped 34px → 44px
  (mobile minimum).
- Admin sheets (Add-path / Settings / Users) on a phone: NOT addressed —
  Add-path's path/suggestions and the panel layouts need an on-device look.
- EPUB iframe vs iOS rubber-band + the both-viewport check: still need a run.

Acceptance: phone-width walkthrough of home → filter → open book →
progress saved → back, plus admin add-path, without horizontal page
overflow — still to be verified on a real phone / narrow emulation.

### P3-4. Webtoon / continuous comic scroll — L

Comic reader is single/double page, LTR/RTL, fit-height / fit-width /
original (`readerStore`, `comicReaderRules.ts`). There is no continuous
vertical mode.

Add a `layout: 'page' | 'scroll'` pref. Scroll mode is a virtualized
column of `<img>`s (the Tauri reader already has `computeVirtualWindow`
— port the idea, do not render 1 000 pages). Preload still keys on
page + HD. Progress is the most-visible page. Spreads are off in scroll
mode.

Acceptance: a 200-page webtoon scrolls smoothly; leaving and reopening
resumes near the same panel; page mode is unchanged.

### P3-5. EPUB reader depth — M

Already shipped: reflowable render, theme / typeface / size, TOC sheet,
paginated flow, CFI + whole-book % progress. Gaps (three S items done
2026-08-14; the M search remains):

- **In-book search — M.** NOT done. Incremental spine-text index, snippets
  by chapter, navigate by CFI. Cache per book id + `file_size` (or hash
  once P1-4 backfill exists). This is *inside the open book*, not
  `searchInside` (that's the library-wide ebook index).
- ~~**Line spacing and margins — S.**~~ Done: `EpubPrefs.lineSpacing`
  (1.2–2.2, default 1.6) + `pageMargin` (12–80 px, default 44) wired through
  `buildEpubTheme` (defaults preserve the old 1.6 / 2rem·2.75rem), a live
  `applyLiveEpubSpacing` walk, and two sliders in the Display settings sheet.
- ~~**Paginated vs scroll — S.**~~ Done: `EpubPrefs.flow`
  (`'paginated' | 'scrolled'`) feeds `renderTo` and live-switches via
  `rendition.flow()`, with a Paginated / Scrolled toggle in the settings sheet.
- ~~**Toolbar scrub actually moves — S.**~~ Done: a post-mount `page` change
  (from the shared toolbar slider) maps slider fraction → CFI via
  `locations.cfiFromPercentage` and displays it; the initial URL page is
  skipped so resume is untouched.

### P3-6. Highlights and notes in the SPA — M

Depends on P2-7 if we want sync; otherwise local-only is a dead end
(the Tauri reader already regretted `localStorage`). Prefer waiting
for the API.

EPUB: range select → color highlight → optional note. List in a sheet,
jump via CFI. Comics/PDF: page-level notes can stay as today's
bookmarks until ink exists.

### P3-7. Per-format / per-book reader defaults — M

`readerStore` persists global comic prefs and global EPUB prefs. There
is no Settings page for them and no per-book override. Add:

- ~~A Settings "Reader" section that edits the same store without opening
  a book.~~ Done (2026-08-14): `ReaderDefaultsSection` in Settings — comic
  defaults (zoom / direction / page turn / spread / HD upscale) and EPUB
  defaults (theme, typeface, font size, line spacing, margins, layout,
  double page), all writing the same `readerStore` the readers use. Every
  new book opens with these.
- Optional per-book overlay (`localStorage` key per id, or a
  `user_reader_prefs` table if we want it on every device). Reset this
  book / reset all, matching the Tauri reader — NOT done. The readers
  would need to layer per-book overrides over the globals (effective
  prefs) and route their in-book settings sheets to per-book; the wiring
  touches both readers and should be done with a live browser to verify.

Configurable **keyboard shortcuts** (features.md) are a follow-on — the
binding tables in `readerPageHelpers.ts` / `useComicKeyboard.ts` would
need a remapper. Do not do this in the same PR as defaults.

### P3-8. Thumbnail quality settings — S

`thumbnailGenerator.ts` hardcodes `MAX_WIDTH = 240`, `MAX_HEIGHT = 360`,
`JPEG_QUALITY = 82`. Expose presets (small / default / large) as
`app_meta` and pass them into the generator. Existing thumbs stay until
a P1-2 batch refresh.

### P3-9. Later / maybe

Worth recording so they are not rediscovered. None of these should
preempt P1.

- **Smart folder rules — L.** Folders are manual + optional `scan_path`.
  A rule ("author = X", "tag = Y", "added in last 30 days") is a saved
  query, not a membership table. Easy to get wrong; do after P1-1 so
  rules cannot leak another user's books.
- **Dictionary lookup — M.** EPUB iframe word tap → define. Needs a
  provider (local startdict / remote). Fail soft.
- **Text-to-speech — L.** EPUB-only, `speechSynthesis` in the SPA is
  enough for a first cut; lock-screen controls are a native-client
  problem.
- **DjVu — L.** New decoder + reader. Do not start without a real
  library that needs it.
- **SPA offline / service worker — XL.** Manifest exists; no SW, no
  Cache Storage. The Flutter / Tauri clients already do offline. A web
  SW that caches `/api/comics/:id/file` is a large cache-budget + auth
  cookie problem. Not a home-server priority.
- **Import / export settings — S.** Dump `app_meta` + reader prefs as
  JSON; restore the same. Low value until there are more knobs
  (P3-7, P3-8).
- **Fit-page zoom — S.** Comics have fit-height / fit-width / original.
  `scaleFit.ts` can already express "contain." Add `fit-page` to
  `COMIC_ZOOM_MODES` if readers miss it.

---

## Suggested delivery order

1. **P1-4** hash backfill + **P1-5** custom covers — small, unblocks
   duplicates and the metadata dialog.
2. **P1-3** embedded metadata — highest catalog-quality return; feeds
   everything already built (search, filters, scraper-as-override).
3. **P1-2** batch ops (selection-bar mark-read, batch metadata,
   select-all-matching, cover refresh) — uses P1-3/P1-5.
4. **P1-8** missing-file badge + locate — operators feel this on any
   real NAS.
5. **P1-7** reading stats + **P3-1** chips / format filter + **P3-2**
   density + recently-added — cheap visible product.
6. **P2-1** jobs & errors view + **P2-9** wiki/comment cleanup.
7. **P1-6** CB7 (do the extension first; image-folders as a second PR).
8. **P1-1** per-user libraries — the big one; schedule after the catalog
   shape (metadata columns, missing_at, language/publisher) has settled.
9. **P3-3** mobile pass + **P2-2** accessibility — need a running UI;
   pair them.
10. **P3-4** webtoon + **P3-5** EPUB depth.
11. **P2-7** annotations API, then **P3-6** SPA highlights.
12. **P2-3 / P2-4 / P2-5** scheduled backup, update check, per-root
    interval — whenever an operator asks.
13. **P2-6** OCR and **P2-8** inotify only with a concrete deploy that
    needs them.

---

## Cross-project pointers

- Tauri reader remaining work (local metadata, in-book search, ink,
  multi-server, TTS, a11y) is **not** duplicated here. Server-facing
  slices of that work are P2-6, P2-7, P1-1, P1-7.
- Flutter at the monorepo root speaks this REST API. Additive fields
  (`language`, `publisher`, `missingAt`, annotation endpoints) are
  fine; renaming existing camelCase fields is not.
- Schema changes stay idempotent (`CREATE … IF NOT EXISTS`,
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS`). No migrations table.

## Out of this document on purpose

Completed v1 items (MOBI de-support, progress debounce, covers table,
upload GC, worker heartbeat, exact-hash ingest, OPDS depth, backup
download, cache controls, version display, CI, first-run onboarding,
empty states, list view, watched roots) are in [`backlog.md`](backlog.md)
and are not restated here.
