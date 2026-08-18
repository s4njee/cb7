# Desktop v2 plan — features for a standalone ebook reader

[plan-desktop.md](plan-desktop.md) (v1) made the desktop app installable: one
codebase, local-first import, native window/menu behavior, CBR parity, CI, and
a release workflow. What v1 deliberately did **not** do is make the app a
competitive standalone ebook reader. Today, a user who never connects a CB8
server gets a flat shelf of manually imported files with filename-derived
titles, no folders, no metadata editing, no in-book search, and several
features (comic bookmarks, tags, series metadata, full-text search) that
silently require the server.

This plan proposes the feature set that closes that gap. It assumes v1 is
shipped and keeps v1's architecture decisions: one Tauri codebase for
mobile + desktop, Rust owns files/networking, imports are copies into
app-owned storage, and the CB8 server stays optional and unbundled.

## Goal

A desktop user with **no server and no account** should be able to:

1. point CB8 at an existing folder of books and get a organized, searchable
   library — not import files one at a time;
2. see real titles, authors, series, and covers extracted from the books
   themselves;
3. search inside a book and across the library;
4. annotate (bookmarks, highlights, notes) any local format and get those
   annotations back out;
5. trust the app with years of reading data: backup, restore, and export are
   first-class.

Connecting a server should upgrade the experience (sync, shared library,
scraped metadata), never unlock basic reader functionality.

## Where standalone currently falls short

Grounded in [features.md](features.md) and the current code:

| Capability | With CB8 server | Standalone desktop today |
| --- | --- | --- |
| Titles/authors/series | Server ingest + scraper | Filename only (`local_import` derives title from the file name) |
| Covers | Server extraction + resize | EPUB/PDF/CBZ first-page heuristics only |
| Tags / collections / series browsing | Server API | None for local books |
| Comic bookmarks | Server-synced | Local-first for comics, PDFs, and EPUB; sync when connected |
| In-book / library full-text search | `/api/search` (server, embeddings) | Title substring match only |
| Reading history | Server history API | None (stats exist on-device, history view does not) |
| Folder-sized libraries | Server watches folders | One-file-at-a-time import; directories are explicitly rejected |
| Metadata correction | webui edit surfaces | None |

Everything below is organized so each area independently improves the
standalone story. Effort tags follow [backlog.md](backlog.md): S (≤½ day),
M (1–2 days), L (3–5 days), XL (>1 week).

## Feature areas

### 1. Library at folder scale

The single biggest standalone gap. Real users have an existing directory tree
of books; "import files one by one, as copies" does not survive first contact
with a 500-book folder.

- [x] **Linked library folders — XL.** Let the user attach one or more
  existing folders that are read *in place* (no copy). Rust scans them,
  catalogs supported files, and watches for changes (`notify` crate) with a
  manual Rescan action as the fallback. Books keep a `source: linked` origin
  in `catalog.json`; a moved/deleted file becomes a "missing" record with a
  Locate/Remove flow (mirror webui's missing-file handling). This was
  explicitly deferred by v1's "keep local files app-owned" decision — v2
  designs it properly: linked books are read-only sources, all app state
  (progress, annotations, covers cache) still lives in app storage keyed by
  content hash, so a re-found file reattaches its history.
  → Implemented 2026-08-16 (v2 commit `…`). `Catalog` gained
  `linked_folders`; `LocalBook` gained `source: "linked"` + `external_path` +
  a derived (never-persisted) `missing` flag. Commands: `local_add_linked_folder`
  (scan + catalog in place, no copy), `local_rescan_linked_folders`,
  `local_remove_linked_folder`, `local_locate_linked_book`. Reads resolve to
  the external path (`book_disk_path`), so linked books page/render exactly
  like copies. A `notify` watcher (desktop-only dep) watches each attached
  folder and emits `shelf://linked-folders-changed`; the frontend offers a
  manual Rescan. UI: avatar-menu "Linked folders…" panel (add/rescan/remove),
  a "Missing" badge on cards whose file vanished, and a Locate button that
  re-points the book. Progress/tags/collections live on the catalog record
  keyed by id, so a re-found file keeps its history. Tests:
  `linked_books_resolve_to_their_external_path` (64 Rust tests). Verified:
  clippy clean, iOS target compiles, `pnpm typecheck` + `pnpm build` pass.
- [x] **Recursive folder import — M.** For users who *do* want copies: allow
  dropping/picking a directory, walk it with a preview ("Found 214 supported
  files, 3 unsupported"), then run the existing per-file `local_import`
  pipeline with a progress UI and a per-file report. Bounded depth and a
  cancel button; still never silent.
  → Implemented 2026-08-16 (v2 commit `…`). `local_scan_folder` walks a tree
  (depth cap 8, 2000-file cap) returning `{ supported, unsupported,
  truncated }`; the frontend shows a native confirm before importing.
  `local_import` now emits per-file `shelf://local-import-progress` and honors
  a cancel flag (`local_cancel_import`). Pickers get an "Add folder…" button;
  dropping a folder routes through the same scan→confirm→import flow. Tests:
  walk collects supported recursively, depth cap, file cap (61 Rust tests).
  Verified: clippy clean, iOS target compiles, `pnpm build` passes.
- [x] **Duplicate detection — M.** Content-hash imported files (webui already
  hashes; reuse the approach) so re-importing the same book dedupes to the
  existing record instead of creating a second copy.
  → Implemented 2026-08-16 (v2 commit `…`). `LocalBook` gained `contentHash`
  (SHA-256, streaming/bounded memory); `local_import` hashes the source before
  copying and skips any file whose bytes already exist in the catalog
  ("Already in your library — skipped as a duplicate"), and `local_download`
  hashes the finalized file so downloads dedupe too. TS `LocalBook` carries the
  field. Test: `content_hash` is stable and detects changes (62 Rust tests).
  Verified: clippy clean, iOS target compiles, `pnpm typecheck` passes.
- [x] **Bulk operations — M.** Multi-select in the library grid
  (Cmd/Ctrl-click, Shift-click, marquee optional) with bulk mark-read,
  favorite, tag, delete-local-copy, and re-scan metadata.
  → Implemented 2026-08-16 (v2 commit `…`). Cmd/Ctrl-click toggles a card's
  selection (ring + check overlay); a bulk bar above the grid offers Mark
  read / Mark unread / Favorite / Clear progress / Remove local copy (local
  shelf only), applied via one `Promise.allSettled` per action then a single
  invalidation. Escape or a scope/filter change clears the selection. Tag and
  re-scan metadata are deliberately not in the bar yet — they depend on the
  local tags/metadata model (areas 1.5 / 2); the bar slots are trivial to add
  once those land. Verified: `pnpm typecheck` + `pnpm build` pass.
- [x] **Local collections, series, and tags — L.** The scope-chip browsing UI
  exists for server libraries; give local books the same model: a
  series/volume field on the catalog record, user-defined collections, and
  free-form tags, all stored in `catalog.json` (or its successor, see area 8).
  "Up next in series" should work offline.
  → Implemented 2026-08-16 (v2 commit `…`). `LocalBook` gained
  `series`/`volume`/`tags`/`collections` (serde-default, so legacy catalogs
  round-trip). Rust commands: `local_set_metadata` (series/volume/tags),
  `local_toggle_collection` (add/remove, returns updated list),
  `local_rename_collection`. Frontend: `toRecord` maps the fields onto
  `WebComicRecord`; a `LocalMetadataEditor` on the book detail sheet edits
  series/volume/tags and manages collections; the local shelf filters by tag or
  collection via client params + a filter chip with a Clear control. "Up next
  in series" is served by filtering the local shelf on `series` (the sort/filter
  already reads it); a dedicated series grouping surface is still area 2 work.
  Tests: metadata defaults empty on legacy catalogs (63 Rust tests). Verified:
  clippy clean, iOS target compiles, `pnpm typecheck` + `pnpm build` pass.

### 2. Local metadata and covers

Standalone quality is mostly metadata quality. All of this runs in Rust at
import/scan time and never requires the network.

- [x] **Embedded metadata extraction — L.** Parse EPUB OPF (title, creators,
  series via `calibre:series` / EPUB3 `belongs-to-collection`, language,
  description, publisher, date), PDF document info/XMP, and ComicInfo.xml
  inside CBZ/CBR. Populate the catalog record; keep the raw filename as a
  fallback field.
  → Implemented 2026-08-17. Added `src-tauri/src/metadata.rs` with
  best-effort EPUB OPF, PDF Info, and ComicInfo.xml extraction. Local catalog
  records now retain authors, description, language, publisher, and publication
  date alongside embedded title/series/volume; malformed metadata never blocks
  import, and legacy catalogs deserialize with empty defaults. Import, OPDS
  downloads, and linked-folder scans all use the same extractor. Verified with
  82 Rust tests, the live-server test, Clippy, frontend typecheck, and build.
- [x] **Filename/series heuristics — M.** For comics without ComicInfo.xml,
  parse `Series v02 #013 (2019)`-style names the way the webui scanner does;
  share the rules in one documented module so client and server agree.
- [x] **Proper cover pipeline — M.** Extract the declared EPUB cover (not just
  a first-image guess), render PDF page 1 at a bounded size, first page for
  comics; cache resized covers on disk keyed by content hash so linked-folder
  rescans don't re-render.
- [x] **Metadata editing UI — M.** An Edit mode on the book detail sheet:
  title, authors, series/volume, tags, cover replacement (pick an image or a
  page). User edits are stored as overrides that survive a rescan.
  → Implemented 2026-08-17. Added shared filename fallback heuristics for
  common `Series v02 #013` names, declared EPUB cover extraction, stable
  content-hash cover paths, and native image-picker cover replacement. The
  local detail sheet now edits title/authors as well as series/volume/tags;
  linked-folder rescans preserve edited metadata. Malformed metadata remains
  non-fatal. Verified with native and frontend checks.
- [ ] **Optional online metadata lookup — L, opt-in.** Fetch
  title/author/description/covers from public sources (Open Library;
  ComicVine needs a user key). Strictly manual/opt-in per the privacy posture:
  a standalone reader must never phone home by default. Clearly separated
  from the CB8 server's scraper.

### 3. Search

- [x] **In-book text search — L.** Search inside the open EPUB (walk spine
  sections, highlight matches, jump with the existing back-stack/Return
  control) and PDF (pdf.js text layer). Listed unchecked in features.md
  today; on desktop `Cmd/Ctrl+F` while reading should do this instead of
  library search.
  → Implemented 2026-08-16 (v2 commit `…`). `src/lib/searchText.ts` is a pure,
  unit-tested helper (whitespace-normalized, case-insensitive, capped matches,
  per-section collapse). `ReaderApi.search` is implemented by both readers:
  EPUB walks the spine reading each section via the publication
  (`readAsString`, chunked 8-at-a-time, best-effort per section) and returns
  per-section hits with the TOC label + snippet; PDF reads `getTextContent()`
  per page (chunked 40) and returns per-page hits. A `SearchDrawer` (🔍 in the
  reader chrome, or `Cmd/Ctrl+F` while reading — routed to in-book search
  instead of library search via a `readerSearchTick` the Reader watches) lists
  hits and jumps through the existing back-stack. Verified: `pnpm test`
  (searchText vectors + 9 existing suites), `pnpm typecheck` + `pnpm build`,
  clippy clean, iOS target compiles.
- [x] **Library search beyond titles — S.** Once area 2 lands, match
  author/series/tags in the existing search box, with simple field prefixes
  (`author:`, `series:`).
  → Implemented 2026-08-16 (v2 commit `…`). `searchText.ts` gained
  `matchesLibraryQuery` / `parseLibraryQuery`: an unprefixed query matches
  title, author, series, tags, and collections; `author:` / `series:` /
  `tag:` / `collection:` (alias `col:`) prefixes scope to one field. The local
  shelf filter (`applyClientParams`) uses it, so series/tags/collections now
  searchable offline (author arrives with area 2 metadata — the matcher
  handles it when the field exists). The server shelf already FTS-matches
  title/author/series/summary; a prefixed query has its prefix stripped before
  the API call so `series:foo` searches `foo` instead of tokenizing to
  `series & foo`. Tests: 3 new library-search vectors (9 total in searchText).
  Verified: `pnpm test` (10 suites), `pnpm typecheck` + `pnpm build` pass.
- [ ] **Local full-text library search — XL, later.** Index EPUB/PDF text into
  a local index (tantivy or SQLite FTS5) built as a background job, with a
  storage cap and per-library opt-out. Results deep-link into the book at the
  match. This is the standalone answer to the server's `/api/search`; do it
  only after in-book search proves the extraction path.
  → Implementation report (2026-08-17): first standalone slice shipped in
  `src-tauri/src/local_search.rs`, `src/lib/transport.ts`, and
  `src/components/Library.tsx`. EPUB XHTML/XML is extracted into a disposable
  JSON sidecar (`search-index.json`); PDFs use best-effort plain literal-string
  extraction, while pdf.js remains authoritative for in-book search. The
  index is capped at 64 MiB, enabled by default, and can be disabled through
  native settings commands; disabling removes the sidecar. The local search
  box now shows “Inside your books” results with snippets and opens the
  matching book. Added two native unit tests. Verified: 78 Rust tests,
  `pnpm typecheck`, and `pnpm build` pass. Remaining XL work: move rebuilds to
  a durable background queue, use a real FTS index (SQLite FTS5/Tantivy), and
  preserve an exact EPUB/PDF position for result deep-links.

### 4. Formats

- [x] **MOBI/AZW3 (DRM-free) — L.** The most-requested "my old Kindle files"
  format. Options: convert-on-import to EPUB in Rust (`mobi` crate for
  classic MOBI; AZW3 is EPUB-adjacent) rather than writing a fourth renderer.
  Convert-on-import keeps the reader surface at three engines and fits the
  app-owned-copy model. DRM'd files are detected and rejected with an honest
  message — no circumvention.
  → Implemented 2026-08-17. Added the Rust `mobi` parser and
  `src-tauri/src/mobi_import.rs`, which converts readable MOBI/KF8 (AZW3)
  content and basic metadata into an app-owned EPUB during `local_import`.
  The existing EPUB/Readium reader remains the only reflowable reader path;
  source files are never modified, and parser failures surface as
  "encrypted or unreadable / DRM-protected books are not supported" per-file
  failures. File picker filters, drag/drop copy, and Tauri file associations
  now advertise `.mobi` and `.azw3`. Verified: `cargo test` (79 native unit
  tests plus the live-server test), `pnpm typecheck`, and `pnpm build` pass.
- [ ] **FB2 and plain TXT/Markdown — M.** Cheap wins via the same
  convert-to-EPUB import path; TXT/MD matter for fanfic and drafts.
- [x] **CB7 and plain image folders — M.** The webui already supports both
  (P1-6); desktop parity via the existing `local_zip` abstraction (7z via the
  `sevenz-rust` crate — keep v1's no-sidecar rule) and the linked-folder
  scanner treating an image directory as a comic.
  → Implemented 2026-08-17. Added native CB7/7z page listing and on-demand
  extraction through `sevenz-rust` in `local_zip`, with empty-password-only
  behavior (DRM/encrypted archives fail cleanly). Added direct-image-folder
  detection to recursive scans and linked folders; linked folders retain
  natural page order and read in place, while explicit imports are packed into
  app-owned CBZ storage. Added CB7 picker/file associations, drop copy, comic
  media/content types, folder hashing, and cover/page-count extraction.
  Verified with Rust compile/tests and frontend type/build checks.
- [x] **OPDS browsing as an acquisition source — L.** The connect screen gains
  "Add OPDS catalog" (Standard Ebooks, Project Gutenberg, Calibre-Web, or
  CB8's own `/api/opds`). Browse, then download through the normal import
  pipeline. This gives the standalone app a legal "get books" story without
  bundling a store.
  → Implemented 2026-08-16. Rust `opds.rs` fetches with a dedicated
  `reqwest` client (no CB8 cookie jar) and parses both OPDS 2 JSON and OPDS 1
  Atom into one `OpdsFeed`. Catalogs persist in `opds.json` (passwords never
  returned to the webview). Commands: `opds_list_catalogs`, `opds_add_catalog`
  (probe + save), `opds_remove_catalog`, `opds_browse`, `opds_search`,
  `opds_download`. Download streams to `.part`, then `catalog_owned_file`
  (content-hash + `acquiredFrom` dedupe) so the book is a normal local copy.
  Progress reuses `shelf://local-download-progress`. UI: connect-screen
  "Add OPDS catalog", avatar-menu "OPDS catalogs…", empty-shelf "Browse a
  catalog"; presets for Standard Ebooks and Project Gutenberg. Tests: 12 new
  parser/policy vectors (76 Rust tests). Verified: clippy, `pnpm typecheck`.

### 5. Annotations that don't need a server

- [x] **Local-first bookmarks for every format — M.** Comic and PDF bookmarks
  currently require the server. Store all bookmarks locally (page index /
  CFI / PDF page) and sync them opportunistically when a server is connected,
  same pattern as the progress outbox.
  → Implemented 2026-08-16. `src/lib/bookmarks.ts` is the on-device store
  (`shelf.bookmarks.v2`). Keys isolate `local` vs `server+user` vs `guest`
  so ids never collide. `list`/`create`/`delete` always write locally;
  a signed-in session merges by page/CFI, POSTs unsynced rows, and DELETEs
  tombstones (flushed on reader `online` / visibility / sign-in). Guests
  get the ribbon. Legacy `shelf.local.bookmarks` and old EPUB CFI keys
  migrate in. Tests: 11 bookmark vectors. Verified: `pnpm test` +
  `pnpm typecheck`.
- [x] **Notes on highlights and bookmarks — M.** A text note attached to any
  highlight/bookmark, shown in the annotation list and on tap.
  → Implemented 2026-08-16. `StoredHighlight` gained `note` (legacy rows
  normalize to null on load) plus pure `withHighlightNote`; `bookmarks.ts`
  gained `setStoredNote` and `api.setBookmarkNote` PUTs the note for synced
  rows (the server contract already had `PUT .../bookmarks/:id`). `BookmarkItem`
  / `HighlightItem` carry `note` up through all three readers, and `ReaderApi`
  gained `setBookmarkNote` / `setHighlightNote`. The TOC drawer shows each note
  under its row and adds a per-row ✎ that opens an inline editor (Save /
  Cancel / Remove note; a blank note clears). Tests: 4 new bookmark vectors +
  a new `highlights` vector suite (5 vectors). Verified: `pnpm test` (12
  suites), `pnpm typecheck` + `pnpm build`.
- [x] **PDF highlights — L.** Text-layer-anchored highlights in pdf.js to
  match the EPUB capability.
  → Implemented 2026-08-17. `PdfReader` now mounts pdf.js `TextLayer`
  overlays over rendered pages, captures same-page text selections, and
  stores normalized highlight rectangles plus excerpt/color/note in the
  local annotation store (`shelf.pdf-highlights.*`). Highlights render back
  over the canvas in paged, spread, and continuous-scroll modes; they appear
  in the shared Highlights drawer with jump-to-page, remove, and note editing.
  Added persistence/rectangle test coverage in `highlights.test.ts`.
  Verified: `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.

### Bugfix pass — 2026-08-17

- Re-ran the full frontend and native verification suites: Vitest, TypeScript,
  Vite production build, Rust tests, and Clippy all pass.
- Fixed local full-text index invalidation after imports, downloads, deletes,
  linked-folder scans, linked-folder removal, and Locate operations so search
  cannot retain removed or newly added books indefinitely.
- Fixed linked-folder reattachment to preserve progress, favorites, series,
  tags, collections, covers, origin, and original added time instead of
  resetting the existing record during a rescan.
- [ ] **Annotations drawer — M.** One per-book list of bookmarks + highlights
  + notes with jump-to, edit, delete; entry from reader chrome and the book
  detail sheet.
- [ ] **Annotation export — S.** Export a book's highlights/notes to Markdown
  and JSON (file save dialog on desktop). Reading data the user can't take
  out isn't owned by the user.

### 6. Reading experience upgrades

Desktop-relevant items from the features.md roadmap plus new desktop-native
ones:

- [ ] **Follow-OS theme — S.** `prefers-color-scheme` → dark/light theme
  option alongside the explicit themes.
- [ ] **Image zoom — M.** Click/pinch an EPUB illustration or comic page into
  a pan/zoom lightbox; scroll-wheel zoom on desktop, with fit-width /
  fit-height / original modes for comics.
- [ ] **Text-to-speech — L.** Read-aloud via the platform voices
  (`SpeechSynthesis` is available in WKWebView/WebView2/WebKitGTK), sentence
  highlighting, sleep timer integration, play/pause from the reader chrome
  and (later) OS media keys.
- [ ] **Hyphenation and justification toggles — S.** CSS-level; already on
  the checklist.
- [ ] **Page-turn animation options — M.** Slide/fade (skip curl), honoring
  reduced-motion.
- [ ] **Comic guided panel mode — XL, later.** Panel-by-panel reading needs
  panel detection; treat as experimental and desktop-last since large screens
  need it least.

### 7. Desktop power features

- [ ] **Multiple windows — L.** "Open in New Window" for a book so notes/
  reference reading works. Requires window-scoped reader state (today the
  store assumes one reader session) — audit before committing.
- [ ] **Quick switcher — M.** `Cmd/Ctrl+K` fuzzy title/author jump, the
  desktop muscle-memory feature.
- [ ] **Continue-reading on launch — S.** Optional "reopen last book on
  start" preference, plus File > Open Recent listing recent books.
- [ ] **Signed updater + Check for Updates — M.** Deferred from v1 Phase 7 by
  design; a standalone consumer app needs it. Gate on one proven
  manual-upgrade release, per the v1 plan.
- [ ] **Sleep timer — S.** Already on the checklist; pairs with TTS.
- [ ] **Full keyboard/accessibility audit — M.** Screen-reader labels
  (VoiceOver/NVDA/Orca), focus order through grid → sheet → reader, and a
  shortcut cheat-sheet under Help (`Cmd/Ctrl+/`).

### 8. Data ownership and durability

The catalog is about to grow from "progress + favorites" to metadata,
collections, annotations, and search state. Protect it first.

- [x] **Catalog storage upgrade — L.** `catalog.json` full-file rewrites won't
  scale to thousands of records with per-page progress writes. Move local
  state to SQLite (rusqlite) with a one-time migration from `catalog.json`;
  keep the write-through + crash-safe semantics v1 established. Do this
  *before* linked folders and annotations multiply row counts.
  → Implemented 2026-08-17. Added `src-tauri/src/storage.rs` with a bundled
  SQLite catalog store (`catalog.sqlite3`) using WAL + `synchronous=FULL` and
  transactional commits. The existing in-memory catalog/write-lock API stays
  intact, while persistence now updates/deletes only changed book rows and
  stores linked folders and catalog counters transactionally. First launch
  migrates legacy `catalog.json` once; the legacy file is retained as a
  recovery copy, and subsequent launches read SQLite directly. Local search
  now reads from the SQLite store as well. Added migration, changed-row, and
  deleted-row tests. Verified: 85 Rust tests pass, Clippy is clean with
  warnings denied, `pnpm typecheck` passes, and `pnpm build` passes.
- [ ] **Backup and restore — M.** File > Export Library Backup produces one
  archive (catalog DB, annotations, prefs, — optionally the copied books);
  restore replays it on a new machine. This is also the honest standalone
  answer to "how do I move computers?" without a sync service.
- [ ] **Storage management UI — M.** Per-book and total disk usage (copies,
  media cache, covers, search index), per-book eviction, and a cache size
  cap — features.md lists only "clear all" today.
- [ ] **Reading history, local — S.** Record open/close sessions locally so
  the history view works signed-out; merge with server history when
  connected.

## Suggested sequencing

Each phase is shippable on its own.

1. **Foundation:** catalog SQLite migration (8), embedded metadata + covers
   (2), library search fields (3). Everything else builds on these records.
2. **Scale:** recursive import, dedupe, bulk ops, local
   collections/series/tags (1); metadata editing (2).
3. **Linked folders** (1) — the flagship standalone feature, riskiest, after
   the catalog and scanner are proven.
4. **Search & annotations:** in-book search (3); local bookmarks everywhere,
   notes, annotations drawer, export (5).
5. **Formats & acquisition:** MOBI/AZW3, TXT/FB2, CB7/image folders, OPDS
   (4).
6. **Comfort & polish:** follow-OS theme, image zoom, TTS, quick switcher,
   Open Recent, updater, backup/restore, storage UI, accessibility audit
   (6, 7, 8).
7. **Later / experimental:** local full-text index (3), multi-window (7),
   guided panels (6).

## Explicitly out of scope for v2

- Bundling the CB8 server, Postgres, or any always-on service (unchanged
  from v1).
- Any DRM circumvention; DRM'd files are rejected with a clear message.
- A hosted sync service or peer-to-peer sync; cross-device sync remains the
  CB8 server's job. (Backup/restore is the standalone migration path.)
- Store submission (Mac App Store / Microsoft Store) — still a separate
  sandboxing project.
- Editing books themselves (EPUB editing, comic archive repacking).
- Social features (reviews, sharing to services, Goodreads integration).

## Risks

| Risk | Mitigation |
| --- | --- |
| Linked folders reintroduce every path/permission problem v1 avoided | Read-only sources, state keyed by content hash, explicit missing-file flow, ship behind the copy-import default |
| `catalog.json` scaling fails mid-plan | Do the SQLite migration first, with a tested one-way migrator and the same atomic-write guarantees |
| Format conversion (MOBI→EPUB) produces broken books | Keep originals, mark converted records, and surface a "conversion report" rather than failing silently |
| Metadata extraction disagrees with the server scanner | Extract shared parsing rules into one documented module; contract-test both against the same fixtures |
| Online metadata lookup undermines the offline/privacy story | Opt-in per action, no background calls, document every network touchpoint in DESKTOP.md |
| Full-text index bloats app storage | Opt-in, capped, per-library toggle, and visible in the storage UI before it ships |
| Desktop-only features drift the mobile codebase | Same discipline as v1: platform module gates, target-gated Cargo deps, mobile build checks in CI |
