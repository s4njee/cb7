# Shelf backlog

Reviewed 2026-08-01 against the current `reader/` Tauri 2 client and the
`webui/` CB8 server. This is a code-based backlog, not a generic reader feature
list. The broader checklist remains in [features.md](features.md).

Effort estimates assume one developer familiar with the codebase:

- **S**: up to half a day
- **M**: one to two days
- **L**: three to five days
- **XL**: more than a week or a cross-project change

## Current architecture and strengths

Shelf is a React/TypeScript reader inside a Tauri WebView, with Rust owning
networking, durable local books, downloads, discovery, and the media cache.
The primary targets are iOS and Android; desktop is also supported. The CB8
server is a separate Fastify/Postgres application.

The project already has unusually strong foundations: local-first EPUB/PDF/CBZ
reading, range-based PDF access, server and local sources behind one API,
offline downloads, a bounded media cache, width-bucketed comic images,
server-synced progress and bookmarks, EPUB highlights, QR pairing, mDNS,
reading statistics, and adaptive phone/tablet layouts.

The highest-return work is therefore reliability and scale rather than adding
another reader mode immediately.

## P0 — reliability and performance

### Debounce and flush reading progress — S

All three readers currently call `putProgress` on every page or EPUB relocation
(`ComicReader.tsx`, `PdfReader.tsx`, and `TextReader.tsx`). A local progress
write clones, serializes, and atomically rewrites all of `catalog.json`.

Add a shared trailing debounce (roughly 750–1000 ms), with an explicit flush
when the reader closes, the app backgrounds, or the WebView unloads. Keep the
latest pending value per book and make writes monotonic within one session.

Expected result: far fewer server requests and disk writes during fast paging,
with no loss of the final position. Add fake-timer tests for burst collapsing
and unmount/background flushing.

### Make local catalog updates transactional under concurrency — M

`local.rs::save` clones the catalog after callers release the catalog mutex,
then performs the file write. Two concurrent mutations can therefore save
snapshots out of order even though each individual rename is atomic.

Serialize mutation plus snapshot ordering with a dedicated save lock or a
single catalog writer. Retain the temporary-file/rename crash-safety behavior.
Add a concurrency test that interleaves progress, favorite, and cover updates.

### Coalesce duplicate media-cache misses — M

The Rust media proxy checks the disk cache and then fetches upstream. Concurrent
requests for the same cold URL can all miss and download/write the same object.
Use a per-cache-key in-flight map so later callers await the first fetch.

This is most visible when the grid, continue card, thumbnail strip, and page
preloader request the same image close together.

### Virtualize long comic/PDF scroll surfaces and thumbnail strips — L

Continuous comic mode and PDF scroll mode create one React element per page;
the comic thumbnail strip does the same. PDF scroll handling also scans every
page slot on each scroll event. This is acceptable for ordinary books but
scales poorly for omnibus PDFs and very long webtoons.

Use a measured window with overscan and `IntersectionObserver`, keep page
anchors stable, and render only the visible thumbnail range. Replace the PDF
scroll loop with observer-driven visibility/current-page tracking. Test books
with 1,000+ pages.

### Bound PDF canvas memory explicitly — M

Rendered PDF canvases retain pixel buffers even after pages leave the buffered
window. Clear offscreen canvas dimensions and cancel/release render tasks when
they leave overscan. Set a small rendered-page budget based on device class.
This matters on iPadOS, where a few DPR-scaled color pages can consume tens of
megabytes each.

### Add an offline progress outbox — L

Server-book progress silently fails when offline. Persist the latest unsent
position per server/user/book, retry after connectivity returns, and expose a
small sync status. Coalesce positions instead of replaying every intermediate
turn. Define conflict behavior before enabling it: default to the furthest
position only when both updates belong to the same reading session; otherwise
ask rather than silently overwriting another device.

## P1 — high-value reader and library work

### Extract embedded metadata during local import — L

Local import currently derives only a title from the filename. Parse
`ComicInfo.xml` for CBZ and the OPF package for EPUB, then add title, author,
series, volume/issue, language, tags, date, and summary to the versioned local
catalog. Follow with a filename parser for archives without embedded metadata
and a metadata editor for corrections.

### In-book EPUB search — M

Build an incremental spine-text index, show result snippets grouped by chapter,
and navigate with CFI anchors. Cache the index per local file fingerprint or
server book/version so reopening does not repeat the work.

### Complete annotation basics — M

EPUB highlights exist, but they are stored in WebView `localStorage`, have no
notes, and do not sync. Add notes, edit timestamps, Markdown/JSON export, and a
durable local annotation repository. This repository should be designed to
hold both text highlights and the freehand strokes described below.

### Multiple saved servers — L

Replace the single persisted server URL with named connection profiles and a
source switcher. Namespace cookies, cache entries, guest progress, highlights,
and query keys by server plus user. Preserve an always-available on-device
shelf.

### Tag browsing and richer shelves — M

The server already exposes tags. Add tag scopes, then expand the home screen
into continue reading, up next, recently added, favorites, and optionally
want-to-read shelves. Shelves should hide when empty and fetch independently.

### Local duplicate detection — M

Hash imported/downloaded files while streaming them into app storage. Reject
exact duplicates before copying and offer a review screen for likely metadata
duplicates. Persist content hashes in the local catalog.

### Cache controls and diagnostics — M

Expose the current cache budget, usage, clear action, per-book local size,
download status, request latency, last sync errors, and log export. Make the
768 MiB media-cache cap configurable within safe presets.

### Comic zoom and pan — L

Add fit-page, fit-width, fit-height, and original-size modes with pinch zoom and
pan. This should precede polished ink annotation because annotations must use
the same page-to-screen transform. Resolve gesture priority among page turns,
pan, WebView scrolling, and stylus drawing in one shared controller.

## P2 — platform and product completeness

- **~~iOS Files/share integration — M.~~** Done: `bundle.fileAssociations` +
  `RunEvent::Opened` → `local_import` copy; iOS library in Documents with
  `UIFileSharingEnabled` / migrate-from-app-data (see `docs/LOCAL-FIRST.md`).
- **~~Android discovery multicast lock — M.~~** Done: `MulticastPlugin.kt` +
  `android_multicast.rs` acquire/release MulticastLock for each browse window
  (DISC-5). Physical-device smoke still recommended.
- **Keep-awake while reading — S.** Enable only while a book is open and honor
  battery-saving preferences.
- **System text-to-speech — L.** Voice/rate controls, sentence tracking,
  interruptions, lock-screen audio controls, and EPUB-only capability gating.
- **Accessibility pass — L.** VoiceOver/TalkBack semantics, focus order,
  dynamic type for chrome, reduced motion, high contrast, and non-color status
  cues.
- **Desktop integration — M.** Native Open/Import and fullscreen menu commands,
  window-state persistence, and drag-and-drop import.
- **Store-ready CI — L.** Typecheck/build, Rust formatting/clippy/tests, browser
  interaction tests, signed TestFlight/Play internal builds, and physical-device
  smoke checklists.
- **~~Split oversized modules — M.~~** Done: `epubDom`, `useLibraryActions`,
  `local_zip`, `download_policy` extracted (report at top of `v2.md`).

## P3 — UI/UX polish

### ~~Make local and server context unmistakable — M~~

Done: source badges on the card action sheet + reader chrome; action verbs
`Save to device` / `Remove local copy` / `Remove download` / `Cancel download`
via `lib/bookContext.ts` (see `v2.md`).

### ~~Add a real book detail sheet — M~~

Done: `BookDetailSheet` with cover, metadata, source badge, size, progress,
download state, tags, and contextual actions; card keeps heart + open; entry via
overflow ···, long-press, right-click, and keyboard `i` (see `v2.md`).

### Improve first-run and empty-shelf guidance — S

The on-device shelf should clearly offer “Add books” and “Connect a server,”
with one sentence explaining that books remain readable offline. Give empty
filters and failed searches a distinct state with “Clear filters”; do not show
the same empty illustration used for a genuinely empty library. When a server
is unavailable, retain the local shelf and show a non-blocking reconnect banner
instead of turning the whole screen into an error state.

### Clarify reader gesture discoverability — M

Show a short, dismissible first-open overlay for tap zones, swipes, chrome
toggle, and pinch/pan once those gestures exist. Add a gesture reference in
reader settings and ensure its labels reflect RTL mode. Avoid teaching gestures
that are unavailable in the current format or layout.

### ~~Reorganize reader settings by intent — M~~

Done: settings grouped Layout / Appearance / Navigation / Accessibility; format-
inapplicable controls hidden; EPUB live typography preview; global vs this-book
typeface scope; Reset this book / Reset all reader defaults with confirm
(`SettingsDrawer`, `READER_DEFAULTS` — see `v2.md`).

### ~~Make progress and navigation feedback more precise — S~~

Done: scrub preview (page/spread + chapter + %) while dragging; page label stays
live; Return control with pulse after jumps; comic spread labels both pages;
document-order numbers in RTL (`scrubPreview`, `Reader` chrome — see `v2.md`).

### ~~Standardize loading, offline, and error states — M~~

Done: `loadState` kinds + `StatusView` / `StatusOverlay` / `MediaPlaceholder` /
skeleton; library, EPUB/PDF, comic pages, covers wired; content kept on refresh;
blocking only when empty (see `v2.md`).

### ~~Improve download feedback and interruption recovery — M~~

Done: pin statuses queued/active/paused/failed/complete; throttled progress;
resume banner + Retry; detail sheet “Download for offline”; last_error on
manifest (see `v2.md`).

### Add lightweight library display controls — M

Offer compact/comfortable cover density, optional metadata lines, and a list
view for large or poorly covered libraries. Persist these independently by
device class so a phone preference does not force an overly sparse iPad grid.
Keep sorting/filtering state visible and provide one “Reset view” action.

### Refine search and scope transitions — M

Keep search terms when entering a collection, series, or tag only when the
scope remains visible; otherwise make the reset explicit. Show active filters
as removable chips, include result counts, and debounce server queries. Preserve
scroll position and the prior scope when returning from a book so exploration
does not restart at the top.

### Add an annotation-specific interaction pass — M

When ink ships, give annotation mode a strong but unobtrusive state indicator,
an obvious exit, undo/redo, and a compact tool palette that avoids covering the
active page. Show unsaved/sync state without interrupting drawing. Pencil input
must not unexpectedly page or hide chrome, while finger navigation behavior
should remain predictable and explained in the palette.

### ~~Run a motion and visual-consistency cleanup — S~~

Done: drop shadows removed (borders/surface steps); motion tokens +
`prefers-reduced-motion`; no entrance animation on continuous scroll; chip /
download-row height reserved (see `v2.md`).

## Epic — Watched library roots (drop-folder ingest) — L overall

**Problem.** Adding books from the server is still a one-shot “browse a path and
scan” flow (`POST /api/admin/add-path`). After the first scan you can rescan a
folder (`POST /api/folders/:id/rescan`) and a global auto-rescan interval exists
(`auto_rescan_interval_min` + `folderScheduler` in the worker), but the model is
awkward for a drop folder:

- Rescan **derives** the path from existing comic file paths. An empty folder,
  a brand-new drop root, or a root that only holds new un-ingested files cannot
  be rescanned until something is already in the catalog.
- Auto-rescan is a single global minutes setting, not “these are my watched
  roots.” It is easy to miss, and there is no first-class “this path is
  registered — just hit Rescan” affordance after the initial browse.
- Dropping files onto a remote/NFS path still forces either re-running add-path
  with the same path or hoping global auto-rescan is on and the folder already
  has comics.

**Goal.** Treat library paths as **durable watched roots**. Register a server
path once (or promote an existing folder to a root), scan it on a configurable
interval, and always offer a **Rescan** button that reuses the stored path —
no re-browsing. Dropping files into that folder (local disk, mount, or remote
share visible to the worker) should surface new books after the next interval
or an immediate manual rescan.

**Existing scaffolding to build on (do not reinvent):**

- `webui/src/main/folderScheduler.ts` — non-overlapping interval scheduling
- `POST /api/folders/:id/rescan` + incremental `folder_scan_ts:*` cursors
- `GET/PUT /api/settings/auto-rescan-interval`
- Worker `ingest-scan` jobs (`jobs/queues.ts`, `producer.ts`, `handlers.ts`)
- Settings UI: `AutoRescanSection` in the admin settings panel

**Out of scope for this epic:** inotify/FSEvents live file watching (optional
follow-on); client-side local-import changes; recursive series policy changes
beyond what add-path already supports.

### Stories

#### 1. Persist an explicit scan root per watched folder — M

Store a durable `scanPath` (absolute path the worker can see) on each library
folder that is meant to be watched, instead of only inferring a common ancestor
from already-ingested files.

- Schema / migration for folder scan root (or a dedicated `library_roots` table
  if folders remain pure virtual collections).
- `add-path` that targets a folder **writes** that path as the folder’s root.
- Empty folders with a registered root are valid watch targets.
- Admin API returns `scanPath` (or a safe display form) for roots; never required
  for virtual folders that only group existing comics.

Acceptance: create/register `/data/incoming`, delete all catalog entries for
testing if needed, and still be able to rescan that path from the stored root.

#### 2. One-click Rescan without re-browsing — S

Admin UI on each watched folder (and/or a central “Library roots” list): a
**Rescan** button that enqueues an incremental `ingest-scan` for the stored
`scanPath`.

- Prefer the stored root; fall back to today’s common-dir derivation only for
  legacy folders that lack a root.
- Show job status (queued / running / last success / last error) already
  available via scan jobs.
- Optional **Rescan all roots** action for multi-root installs.

Acceptance: drop a new CBZ/EPUB into the watched path on the host, click Rescan
once, and the title appears without opening the add-path browser again.

#### 3. Configurable interval that is clearly “for watched roots” — S

Keep a global default interval, but product-copy and settings should say
**watched folders**, not an obscure auto-rescan toggle.

- Defaults and presets (e.g. off / 5 / 15 / 60 min) with clear “0 = manual
  only.”
- Optional stretch: per-root interval override; if not, document that one global
  interval covers all roots (matches current `folderScheduler`).
- Scheduler only walks folders that have a registered `scanPath` (and optionally
  an enabled flag), not every virtual folder.

Acceptance: with interval set to 5 minutes, new files appear without any UI
click; with interval 0, only manual Rescan adds them.

#### 4. Watched-roots admin surface — M

A single admin place (settings subsection or Library admin page) listing:

| Path | Folder / label | Interval | Last scan | Status | Actions |
| --- | --- | --- | --- | --- | --- |

Actions: **Rescan**, enable/disable auto, edit path, remove watch (does not
delete files or necessarily delete catalog rows — product choice, document it).

- “Add watched folder” reuses path picker / typed path used by add-path today.
- First scan runs immediately on register.
- Missing mount (NFS down) shows a clear offline/path-missing state instead of
  silent skip only in worker logs.

Acceptance: an operator can manage drop folders without memorizing paths or
using add-path as a rescan workaround.

#### 5. Incremental scan correctness for drop workflows — M

Tighten incremental behavior so drop-folder use is trustworthy:

- New files under the root are picked up; unchanged files are not re-ingested.
- Files removed from disk: define and implement policy (mark missing vs leave
  catalog; at minimum do not crash the scan).
- Concurrent manual + scheduled rescan of the same path stays single-flight
  (already partly handled by job singleton keys — verify and document).
- Large roots: progress and last-error remain visible in admin UI.

Acceptance: add 10 files, rescan → 10 new; rescan again → 0 new, no errors;
remove one file → policy applied without failing the job.

#### 6. Ops / docs — S

Update server docs (`README`, wiki ops, `AGENTS.md`) for:

- Registering a watched root vs one-shot add-path.
- Interval configuration and worker requirement (`cb8-worker` must be running).
- Typical remote-share layout (path must be mounted on the worker host, not the
  admin’s laptop).

Acceptance: a new admin can set up “drop CBZs in `/mnt/comics/incoming` and they
show up” from the docs alone.

### Suggested delivery order

1. Story 1 (persisted `scanPath`) — unblocks empty-folder rescan.
2. Story 2 (Rescan button) — immediate user value.
3. Story 3 (interval clarity + root filtering).
4. Story 4 (watched-roots UI).
5. Story 5 (incremental/edge-case hardening).
6. Story 6 (docs).

### Notes for implementers

- Primary work is **`webui/`** (API, worker, admin SPA), not the Tauri reader.
- Prefer extending `folderScheduler` + folder rescan over a new FS watcher.
- Realtime inotify/FSEvents can be a later epic if interval + Rescan is not
  enough for large drop volumes.

## Apple Pencil and stylus annotation evaluation

### Recommendation

Start with a WebView canvas/SVG ink layer for **fixed-layout pages** (CBZ/CBR
from the server, local CBZ, and PDF). It can support Apple Pencil, Samsung S Pen,
Surface Pen, fingers when enabled, and mouse input through the same Pointer
Events path. Do not begin with a native PencilKit overlay, and do not promise
freehand ink on reflowable EPUB in the first release.

The browser input model exposes a `pen` pointer type plus pressure and tilt.
Where supported, coalesced events provide smoother high-frequency paths. These
capabilities must be proven in this app on a physical iPad and representative
Android stylus before committing to latency or pressure-sensitive acceptance
criteria; simulator and mouse testing cannot validate them.

### Scope and difficulty

| Scope | Difficulty | Estimate | Notes |
| --- | --- | --- | --- |
| Physical-device input spike | Low | 1–2 days | Log pointer type, rate, pressure, tilt, coalesced events, cancellation, palm contacts, and behavior across the Tauri iOS/Android WebViews. |
| Fixed-page local ink MVP | Medium | 5–8 days | Pen/highlighter/eraser, undo/redo, finger-vs-stylus policy, normalized page coordinates, local persistence, and single-page PDF/comic support. |
| All fixed-page layouts | High | +1–2 weeks | Spread, RTL, webtoon/PDF scroll, rotation, zoom/pan, page virtualization, export, and robust hit testing. |
| Cross-device/server sync | High | +1–2 weeks | Postgres schema, authenticated API, incremental changes, deletion tombstones, conflict rules, limits, and client outbox. |
| Reflowable EPUB freehand ink | Very high | +2–4 weeks | Ink must anchor to text/CFIs or a rendition fingerprint and survive font, margin, flow, orientation, and chapter layout changes. Some marks cannot be mapped reliably. |
| Native PencilKit quality | Very high / iOS-only | 3–6 weeks | Tauri Swift plugin plus `PKCanvasView`/tool picker, WebView overlay coordination, transform synchronization, serialization bridge, lifecycle work, and a separate Android implementation. |

A useful fixed-page local MVP is therefore approximately **one to two weeks**.
A polished, synced, cross-platform annotation system is approximately **four to
eight weeks**, depending on whether EPUB ink and native PencilKit are included.

### Proposed fixed-page design

1. Add an explicit annotation mode. Outside that mode, the existing tap, swipe,
   scroll, and scrub gestures remain unchanged. Default to stylus-only drawing;
   one-finger gestures navigate and two fingers pan/zoom. Offer finger drawing
   as an opt-in.
2. Place one transparent canvas over each rendered fixed page, clipped to the
   exact content rectangle rather than the surrounding reader stage. Give the
   image/PDF renderer and annotation layer one shared transform.
3. Store points in normalized page coordinates (`x/pageWidth`,
   `y/pageHeight`) with pressure, time, optional tilt, and tool attributes.
   Persist vector strokes, not flattened bitmaps, so rotation, resolution,
   themes, and export remain lossless.
4. Batch pointer samples per animation frame and use coalesced samples when the
   WebView supplies them. Draw an immediate preview, simplify/smooth after
   stroke completion, and persist only after the stroke ends.
5. Use a versioned model such as:

   ```text
   annotation(id, bookKey, pageIndex, kind, color, width, points,
              createdAt, updatedAt, deletedAt, deviceId, revision)
   ```

   `bookKey` must include source identity. A server book needs server URL plus
   comic ID; a local book should use a stable content hash rather than its
   catalog integer alone.
6. Keep annotation blobs out of `catalog.json` and `localStorage`. Use a small
   native database or per-book appendable files with atomic indexing. The
   catalog should only carry summary counts/version information.

### Server work for sync

Add a per-user annotations table keyed to the comic and a versioned REST API.
Upload individual annotation changes rather than replacing a whole book's
drawing. Enforce authenticated ownership, payload and point-count limits, and
pagination. Use client-generated UUIDs for idempotent offline retries and
`updatedAt`/revision plus tombstones for deletes. Annotations must be deleted by
cascade when the owning user or catalog record is removed, without ever
modifying the source book file.

### Why PencilKit is optional, not the first step

Apple's `PKCanvasView` provides low-latency Pencil capture, pressure/angle-aware
inking, erasing, selection, and the native tool picker. It would produce the
best iPad experience. In this project, however, pages live inside a WKWebView.
A native canvas must be layered above that WebView and kept pixel-aligned while
React changes pages, scrolls, zooms, rotates, enters spreads, or hides chrome.
Its `PKDrawing` data must also cross a Tauri mobile-plugin bridge and be mapped
to a portable format if Android/web clients are expected to edit it.

Use PencilKit only after the WebView MVP and coordinate/persistence model are
stable, or if the product explicitly prioritizes iPad-only ink quality over
cross-platform parity. Relevant references: Apple's
[PKCanvasView documentation](https://developer.apple.com/documentation/pencilkit/pkcanvasview)
and the web [PointerEvent model](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent).

### Acceptance gates for the initial spike

- Apple Pencil is reported distinctly from a finger on a physical supported
  iPad; an Android stylus is tested separately.
- Pressure is non-constant when hardware supports it; missing tilt/coalesced
  samples degrade gracefully.
- Palm contact does not page, draw, or toggle chrome while the Pencil is down.
- A stroke remains aligned after rotation and page resize.
- Drawing does not trigger page navigation or browser scrolling.
- A 60-second continuous drawing session has no obvious input lag, runaway
  memory growth, or main-thread long tasks.
- Background/foreground and forced reader close do not lose the last completed
  stroke.

## Suggested delivery order

1. Progress debounce/flush and catalog-write ordering.
2. Physical stylus input spike plus the shared zoom/page transform.
3. Fixed-page local ink MVP backed by durable annotation storage.
4. Cache-miss coalescing and long-document virtualization.
5. Notes/export and the annotation sync API.
6. Expand ink to spread/scroll layouts; decide separately whether reflowable
   EPUB ink or PencilKit is worth its cost.
