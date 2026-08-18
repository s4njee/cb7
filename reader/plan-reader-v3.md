# Reader v3 plan — a fully fleshed-out ebook reader, desktop and mobile

[plan-desktop.md](plan-desktop.md) (v1) made the desktop app installable.
[plan-desktop-v2.md](plan-desktop-v2.md) (v2) made standalone desktop
credible: linked folders, embedded metadata, covers, local search, MOBI/CB7,
OPDS, local-first bookmarks, notes, PDF highlights, and a SQLite catalog.

v3 is the step from "a capable app" to "the reader someone chooses over
Apple Books, Moon+ Reader, KOReader, or Panels" — on **both** desktop and
mobile, since one Tauri codebase serves them all. The remaining gap is no
longer plumbing; it is reading-experience depth, an annotation lifecycle you
can live in for years, mobile platform integration, a coherent multi-device
story, and accessibility. This plan absorbs the unchecked tail of v2, the
open items in [features.md](features.md), and the P1/P2/P3 remainder of
[backlog.md](backlog.md), then adds the ideas that none of those documents
reached.

## Goal

A reader — on a phone, a tablet, or a desktop — should be able to:

1. tune the reading surface to their eyes and hands: typography,
   brightness, zoom, page-turn feel, tap zones, and have the book *read
   aloud* when their eyes are busy;
2. mark up a book (highlights, notes, bookmarks, and eventually ink), find
   every mark again in one place, and export all of it;
3. move between devices without thinking: multiple servers, progress
   conflict handling that never loses a position, and a library that
   browses fully offline;
4. rely on the app as an accessible, platform-native citizen: screen
   readers, reduced motion, OS theme, widgets, share sheets, and store
   distribution;
5. keep owning their data: backup/restore, storage visibility, and history
   that works signed-out.

Effort tags follow [backlog.md](backlog.md): S (≤½ day), M (1–2 days),
L (3–5 days), XL (>1 week).

## Where the clients still fall short

| Area | State today | Fully fleshed out means |
| --- | --- | --- |
| Reading comfort | Themes, margins, typefaces, spreads | Zoom/pan, page-turn animation, OS-backlight brightness, keep-awake, volume-key turns, custom tap zones, hyphenation |
| Read-aloud | None | TTS with sentence tracking, lock-screen controls, sleep timer |
| Annotations | Create/note/sync exist; no unified list, no export, no ink | One drawer, Markdown/JSON export, translate/copy selection, stylus ink on fixed pages |
| Search | In-book search + first-cut local index | Real FTS5 index with exact-position deep links; semantic results when a server is connected |
| Multi-device | One saved server; furthest-position heuristic | Server profiles, cross-device conflict prompts, offline library snapshot, self-signed cert trust |
| Platform citizenship | Adaptive layouts, file associations | Store pipelines, widgets/quick actions, share-to-server, follow-OS theme, state restoration |
| Accessibility | Reduced-shadow/motion tokens only | VoiceOver/TalkBack/NVDA audit, dynamic type, high contrast, reading ruler |
| Data ownership | SQLite catalog, stats | Backup/restore archive, storage management UI, local reading history |

## Feature areas

### 1. Reading experience depth

The daily-feel gap. Everything here is format- and platform-gated through
the existing settings-by-intent drawer and `platform.ts` capability split.

- [ ] **Comic/image zoom and pan — L.** Pinch (mobile), scroll-wheel +
  drag (desktop), double-tap-to-zoom; fit-page / fit-width / fit-height /
  original modes. One shared page-to-screen transform controller — this is
  the prerequisite the stylus-ink epic (area 3) anchors to, so build it as
  a reusable transform, not a one-off. Applies to comic pages, PDF pages,
  and EPUB illustrations (tap an inline image into a lightbox).
- [ ] **Page-turn animations — M.** Slide and fade options (skip curl),
  honoring `prefers-reduced-motion` and disabled in scroll modes.
- [ ] **Follow-OS theme — S.** `prefers-color-scheme` as a fourth theme
  option; also restyles chrome, not just the book surface.
- [ ] **True brightness control — M.** Drive the OS backlight on
  iOS/Android via a small Tauri plugin (screen-brightness APIs), keeping
  the overlay dim as the desktop/fallback path. Per-book override optional.
- [ ] **Keep-awake while reading — S.** Wake lock only while a book is
  open; released on background/close; respects low-power mode.
- [ ] **Volume-button page turning — M.** Android-only intercept while the
  reader is open; toggle in Navigation settings.
- [ ] **Tap-target customization — S.** Invert/resize tap zones
  (left-handed mode); a visual editor in Navigation settings showing the
  zones live.
- [ ] **Hyphenation & justification toggles — S.** CSS-level for EPUB;
  the last unchecked typography item.
- [ ] **Gesture onboarding — M.** Dismissible first-open overlay for tap
  zones/swipes/pinch, format-aware and RTL-aware; a gesture reference
  card in reader settings (`Cmd/Ctrl+/` on desktop pairs with the shortcut
  cheat-sheet).
- [ ] **Reading ruler / focus aids — M.** A movable tint band and an
  optional bionic-style emphasis toggle for EPUB; accessibility-listed but
  useful broadly.

### 2. Read-aloud (TTS)

The single biggest "real ebook reader" feature the app lacks. One
implementation, three platforms: `SpeechSynthesis` exists in WKWebView,
WebView2, and WebKitGTK.

- [ ] **Core TTS engine — L.** EPUB-only to start: sentence segmentation
  per spine section, `SpeechSynthesis` playback with voice/rate/pitch
  controls, current-sentence highlight, auto page/section advance.
- [ ] **Media integration — M.** Play/pause from reader chrome; OS media
  keys on desktop; lock-screen/notification controls on mobile via a small
  plugin (MPNowPlayingInfoCenter / MediaSession) with background-audio
  entitlements.
- [ ] **Sleep timer — S.** Auto-stop after N minutes or "end of chapter";
  shared with non-TTS reading ("close book after N minutes" honors the same
  timer). Already on the checklist; lands here because TTS makes it matter.
- [ ] **PDF read-aloud — M, later.** Reuse the pdf.js text layer; gate on
  the EPUB path proving the segmentation model.

### 3. Annotation lifecycle completion

v2 built the pieces (local-first bookmarks, notes, EPUB + PDF highlights);
v3 makes them a system you can rely on for a decade of marginalia.

- [ ] **Annotations drawer — M.** One per-book list of bookmarks +
  highlights + notes, grouped by chapter/page, with jump-to, edit, delete,
  and color filter. Entry from reader chrome and the book detail sheet.
  (Carried from v2 unchecked.)
- [ ] **Annotation export — S.** Per-book Markdown and JSON export (save
  dialog on desktop, share sheet on mobile). A library-wide "export all
  annotations" lives in the backup surface (area 8). (Carried from v2.)
- [ ] **Selection actions — M.** Styled copy/share for text selections
  (quote + title/author attribution), replacing the default epub.js
  handling; "Translate selection" via an opt-in online service or the OS
  translation sheet where available — same privacy posture as online
  metadata lookup (explicit, per-action, never automatic).
- [ ] **Durable annotation store — M.** Move highlights/bookmarks out of
  WebView `localStorage` into the SQLite catalog DB (they are the reading
  data most worth protecting; `localStorage` can be evicted). One-time
  migration; the existing sync/outbox semantics unchanged.
- [ ] **Stylus ink on fixed pages — XL, phased.** The
  [backlog.md](backlog.md) Apple Pencil evaluation stands: physical-device
  input spike first (1–2 days), then a WebView canvas ink MVP on
  single-page comic/PDF layouts using the area-1 shared transform, vector
  strokes in normalized page coordinates stored in the annotation DB.
  Spread/scroll layouts, sync, and any PencilKit work are explicitly later
  gates, each with its own go/no-go.

### 4. Search, navigation, and finding things

- [x] **FTS index maturation — L.** Replaced the v2 JSON sidecar with
  SQLite FTS5 in the catalog DB: incremental per-book fingerprints, a
  durable background rebuild queue (reconcile on launch, after imports and
  linked-folder changes), passage-level deep links from results into the
  book (a serialized Readium locator with progression for EPUB, a page index
  for PDF), and a "Search index" panel showing usage against the cap with
  rebuild / turn-off. Closes the "remaining XL work" note in v2 area 3; the
  per-book eviction view still belongs to the area-9 storage UI.

  <details><summary>Implementation report</summary>

  **Storage.** Three tables in `catalog.sqlite3`: `search_books` (fingerprint,
  bytes, status per book), `search_segments` (one row per indexed passage, with
  its jump target and label), and `search_fts` (FTS5 over passage bodies,
  `unicode61 remove_diacritics 2`). The v2 `search-index.json` is deleted on
  first run. Queries are quoted token-by-token with a trailing prefix `*`, so
  typed punctuation and FTS operators are data, never syntax.

  **Queue.** Work is derived, not stored: a pass reconciles the catalog against
  `search_books` by size+mtime, so only changed books are re-extracted, departed
  books are forgotten, and a run killed mid-rebuild resumes next launch.
  `invalidate_index` only sets a stale bit; a plain thread (never a runtime
  worker) does the blocking zip/PDF work and loops again if the catalog moved
  under it. Kicked at startup, after imports, after linked-folder changes, and
  on any search; progress rides the `local-search-index` event.

  **Deep links.** Sections are chunked at ~1200 chars so a hit's target is a
  passage, not a chapter head: EPUB emits a serialized Readium locator (spine
  href + progression), PDF a 0-based page index from real per-page text via
  `lopdf`. EPUB hrefs are built with the same OPF-dir join and `linear="no"`
  exclusion the frontend parser uses, so targets resolve without fuzzy matching;
  `TextReader.goTo` remaps through the TOC path anyway, keeping progression.

  **Caps.** 64 MB total / 4 MB per book. Over-cap books are recorded as
  `capped` rather than retried each pass; turning search off deletes the index
  instead of only hiding the feature.

  **Verified.** `cargo test` (8 search tests: a generated EPUB indexed
  end-to-end and asserted on href/progression, cancellation leaving work queued,
  unchanged files not re-extracted, removal purging passages), clippy
  `-D warnings`, `cargo fmt`, iOS target check, `tsc`, `vitest`, `vite build`.
  Not exercised: the first live jump inside a running Readium navigator.

  </details>

- [x] **Semantic search surface — M.** `GET /api/search` results now appear
  under "Inside your books, by meaning · on the server", beneath the device's
  own FTS hits in the same dropdown, each hit tagged with how it was retrieved
  (by meaning / keyword). The capability is optional, so a server without the
  route or the sidecar simply contributes no section.

  <details><summary>Implementation report</summary>

  **Contract.** `api.searchInside(q)` wraps `GET /api/search?q=` and returns
  `{ comicId, book, chapter, snippet, via }[]`, where `via` is the server's own
  `keyword | semantic | both` — the fused RRF ranking already tells us which
  retriever produced each passage, so the UI never has to guess.

  **Optional by design.** Older servers lack the route and the sidecar can be
  absent, so the first failure latches the capability off for that server URL
  (reset when the server changes) instead of retrying — and failing — on every
  keystroke. A missing capability is not an error worth showing: the section
  just doesn't appear. The header only claims "by meaning" when at least one hit
  actually came from the sidecar; when the server falls back to keyword-only it
  says "Inside your books · on the server" instead.

  **Two sources, never blurred.** The device group is labelled "· on this
  device" and the server group "· on the server". They differ in what a click
  can promise: a local hit deep-links to the passage (the index stores exact
  targets), while a server hit names a chapter label that is not an addressable
  position, so it opens the book and leaves the rest to in-book search. Local
  passage search now runs on either shelf — the books on this device are yours
  to search regardless of which library you are browsing.

  **Verified.** Contract checked against a live CB8 server
  (`/api/search?q=` → 200 `{query, results}`); `tsc`, `vitest`, `vite build`;
  library screen re-rendered in the dev preview with no console errors.
  Not exercised: the section against live semantic results — that server's ebook
  chunk index returns nothing unauthenticated, and browser dev mode cannot reach
  the signed-in server shelf (`transport.setServer` deliberately blanks the
  server URL outside Tauri).

  </details>
- [ ] **Quick switcher — M.** `Cmd/Ctrl+K` fuzzy title/author jump on
  desktop; the same UI opens from a long-press shortcut / pull-down search
  on mobile. (Carried from v2.)
- [x] **Search & scope transition polish — M.** A search term now survives a
  scope change *because* it stays visible: an active-filter bar shows every
  non-obvious narrowing as a removable chip, with the result count beside it
  and a "Clear all". Returning from a book restores the shelf you left —
  scope, filters, search and scroll offset. (From backlog P3.)

  <details><summary>Implementation report</summary>

  **Terms survive only while visible.** The backlog's condition is met by
  making the term visible rather than by dropping it: `ActiveFilters` renders
  chips for the search term, the scope you browsed into, and the local tag /
  collection filters — each removing exactly one thing. Media type and read
  status stay out of the bar; their own pills are one row above and already
  read as active, so repeating them would be noise. The explicit reset the
  backlog asks for is a "Clear all" chip plus a "Clear filters" button in the
  no-results state, where a scope change that ate every result is most likely
  to strand someone.

  **Result counts.** The header count now reads `12 of 32 titles` wherever the
  unfiltered total is genuinely known — the on-device shelf holds its whole
  catalog in memory, and a series scope arrives as one array. Paged server
  scopes only ever report the filtered count, and a second request just to
  print a denominator is not worth it, so those keep the plain count.

  **Returning from a book.** Opening a book unmounts the library screen, which
  is why exploration used to restart at the top of "All titles". A module-level
  `viewMemory` records shelf, scope, search, filters and scroll offset on
  unmount and restores them on mount. Deliberately not persisted: this is *this
  session's* place in the shelf, not a preference, so a fresh launch opens
  clean. A view taken on a server shelf carries the server URL and is refused
  on a different server — collection ids are not portable — while the on-device
  view travels; signing out forgets it outright.

  **Debounce.** Already in place at 250 ms on the search box; scope and filter
  changes are discrete and need none.

  **Verified.** Vector tests for the memory and the active-filter predicate
  (registered in `vectorSuite`); `tsc`, `vitest`, `vite build`. Exercised in the
  dev preview: the search chip appears with its count, removing it clears the
  box, the empty state offers "Clear filters", and the term plus chip survive a
  library unmount/remount round trip. Not exercised: scroll restoration and the
  scope chip, which need a populated shelf — the browser dev vehicle has no
  on-device library and cannot reach the server shelf.

  </details>

### 5. Library and personalization

- [ ] **Tag browsing — M.** `/api/tags` scope chips for server libraries;
  the local tag model already exists — unify both behind the same chip UI.
- [ ] **Richer home shelves — M.** Continue reading, up next in series,
  recently added, favorites as independent, hide-when-empty rows; local
  and server sources feed the same shelves.
- [ ] **Library display controls — M.** Compact/comfortable density,
  optional metadata lines, and a list view; persisted per device class;
  one "Reset view" action. (From backlog P3.)
- [ ] **Empty-state and first-run guidance — S.** Distinct states for
  empty library vs empty filter vs failed search; "Add books" / "Connect a
  server" / "Browse a catalog" affordances; non-blocking reconnect banner
  when a server drops. (From backlog P3.)
- [ ] **Reading goals — M, optional.** Daily minutes or yearly books
  target on top of the existing stats store, with a streak-aware home
  card. Purely local; pairs with the widgets in area 7.

### 6. Multi-device and accounts

- [ ] **Multiple saved servers — L.** Named connection profiles with a
  fast switcher; cookies, cache keys, guest progress, highlights, and
  query keys namespaced by server+user (the bookmark store already keys
  this way — extend the pattern). The on-device shelf stays always
  available.
- [ ] **Progress conflict handling — M.** The outbox already resolves
  same-session conflicts to the furthest position; add the cross-session
  prompt ("You're at p.212 here, p.240 on iPad — jump?") with a
  per-book "always use furthest" remember option.
- [ ] **Offline library snapshot — M.** Persist the last-seen server
  shelf (records + covers already cached) so browsing works with no
  connectivity, with clear staleness indication and downloaded-only
  filter.
- [ ] **Self-signed certificate trust — M.** First-connect fingerprint
  prompt with pin-on-accept for home-lab HTTPS; Rust owns verification so
  all three WebViews behave identically.
- [ ] **Change-password screen — S.** Parity with webui; small but it
  completes the account story on-device.
- [ ] **Multiple user profiles on one device — L, later.** Per-profile
  progress/annotations/prefs on a shared library; gate on demand — family
  tablets are the use case.

### 7. Platform citizenship (mobile-first)

v1/v2 were desktop-weighted; this area pays the mobile debt.

- [ ] **Store-ready release pipeline — L.** Signing, TestFlight and Play
  internal tracks in CI, physical-device smoke checklist (haptics, camera
  QR scan, multicast discovery, immersive mode — all currently
  simulator-verified only).
- [ ] **State restoration / Handoff — M.** Reopen mid-book after app
  kill; the reader session state (book, position, mode) serialized on
  background. NSUserActivity Handoff between iPhone/iPad is a stretch
  goal on top.
- [ ] **Widgets and quick actions — L.** Continue-reading home-screen
  widget (cover + progress + deep link) on iOS/Android; long-press app
  shortcuts for the last two books and Search.
- [ ] **Share *to* the app — M.** Receive an EPUB/CBZ via share sheet →
  import locally, or (admin, server connected) upload to CB8. The receive
  half is mostly wired via file associations; the upload half needs a
  server endpoint check.
- [ ] **Reduced-motion + follow-OS polish — S.** Honor OS reduced-motion
  everywhere (page-turn animations from area 1 included); follow-OS theme
  from area 1 listed once, verified on all five platforms.
- [ ] **Signed desktop updater — M.** Check-for-updates + signed update
  feed; carried from v2, still gated on one proven manual-upgrade release.
- [ ] **Desktop multi-window — L, later.** "Open in New Window" requires
  window-scoped reader state; audit the store assumptions before
  committing. (Carried from v2.)
- [ ] **Continue-reading on launch + Open Recent — S.** Desktop
  preference to reopen the last book; File > Open Recent. (Carried from
  v2.)

### 8. Accessibility

A fully fleshed-out reader is usable without sight, without fine motor
control, and without tolerance for motion. Do this as an audit + fix pass,
not scattered items.

- [ ] **Screen-reader audit — L.** VoiceOver, TalkBack, NVDA, Orca:
  labels on every control, focus order grid → sheet → reader, live-region
  announcements for page turns and download completion.
- [ ] **Dynamic type for chrome — M.** App chrome (not just book text)
  respects OS text-size settings.
- [ ] **High-contrast + non-color cues — S.** Status conveyed by icon +
  text, never color alone; a high-contrast theme variant.
- [ ] **Keyboard completeness — M.** Every action reachable by keyboard
  on desktop; shortcut cheat-sheet under Help (`Cmd/Ctrl+/`). (Absorbs
  the v2 area-7 audit item.)

### 9. Data ownership and durability

- [ ] **Backup and restore — M.** One archive (catalog DB, annotations,
  prefs, covers, optionally copied books); File > Export Library Backup
  on desktop, share-sheet export on mobile; restore replays onto a fresh
  install. The standalone "how do I move machines" answer. (Carried from
  v2.)
- [ ] **Storage management UI — M.** Per-book and total usage across
  copies, media cache, covers, and the FTS index; per-book eviction; a
  configurable cache cap (backlog's diagnostics item folds in here: last
  sync errors + log export). (Carried from v2.)
- [ ] **Local reading history — S.** Record open/close sessions locally
  so the history view works signed-out; merge with server history when
  connected. (Carried from v2.)

### 10. Formats — the last mile

- [ ] **FB2 and TXT/Markdown — M.** Convert-to-EPUB on import, same path
  as MOBI; TXT/MD matter for fanfic and drafts. (Carried from v2.)
- [ ] **Optional online metadata lookup — L, opt-in.** Open Library (and
  ComicVine with a user key) fetch of title/author/description/covers;
  strictly manual per-action, clearly separated from the CB8 scraper.
  (Carried from v2.)
- [ ] **Comic guided panel mode — XL, experimental.** Panel-by-panel
  reading; mobile-first (small screens need it most), behind an
  experimental flag. (Carried from v2, priority flipped: v2 called it
  desktop-last — it is really a phone feature.)
- [ ] **DjVu — M, later.** Scanned-book format with an existing Rust
  decoder ecosystem; render-to-image path like PDF. Only if user demand
  shows up; listed so the decision is recorded.

## Suggested sequencing

Each phase is shippable alone; mobile and desktop ship together from one
codebase throughout.

1. **Comfort core:** zoom/pan transform + lightbox, follow-OS theme,
   keep-awake, hyphenation, tap zones, page-turn animations (1).
2. **Annotation completion:** durable store migration, annotations
   drawer, export, selection copy/share (3) — small items, huge
   trust payoff.
3. **Read-aloud:** TTS engine, media integration, sleep timer (2).
4. **Finding things:** FTS5 maturation, quick switcher, tag browsing,
   shelves, display controls, empty states (4, 5).
5. **Multi-device:** multiple servers, conflict prompts, offline
   snapshot, cert trust (6).
6. **Platform pass:** store pipeline, state restoration, widgets,
   share-to-app, updater (7) + the accessibility audit (8) as one
   release-blocking gate.
7. **Ownership:** backup/restore, storage UI, local history (9);
   FB2/TXT, online lookup (10).
8. **Experimental track (parallel, gated):** stylus ink spike → MVP (3),
   guided panels (10), multi-window (7), profiles (6).

## Explicitly out of scope for v3

- Audiobooks (M4B playback, Whispersync-style position linking) — a
  different media pipeline; revisit as its own plan if demand appears.
- A hosted sync service; cross-device sync remains the CB8 server's job,
  with backup/restore as the serverless migration path.
- DRM circumvention of any kind (unchanged).
- Book editing (EPUB editing, archive repacking) and Calibre-style
  library management beyond the metadata editor that already shipped.
- Social features: reviews, Goodreads, shared shelves.
- Mac App Store / Microsoft Store sandboxed submissions — the direct
  store pipelines in area 7 cover iOS/Android; desktop store sandboxing
  stays a separate project.

## Risks

| Risk | Mitigation |
| --- | --- |
| Zoom/pan gesture conflicts with page turns, scrolling, and future ink | One shared transform + gesture controller built first, with an explicit priority table; stylus spike validates it on hardware before ink commits |
| TTS behaves differently per WebView (voices, background audio) | Capability-probe at runtime; EPUB-only first; platform plugin only for lock-screen controls, not synthesis itself |
| `localStorage` annotation migration loses data | Migrate read-only first (copy, verify counts, then switch writes); keep the localStorage copy for two releases |
| Multi-server namespacing misses a store and leaks state across profiles | Audit every persisted key against the bookmark store's existing `server+user` pattern; add a vector test that switches servers and asserts isolation |
| Store review rejects the app (background audio, file access) | Entitlement review before the pipeline work; TestFlight/internal-track soak before public listing |
| Accessibility audit findings balloon | Treat area 8 as a release gate with a fixed scope (labels, focus, motion, contrast) — new findings beyond that scope become backlog items, not blockers |
| Widget/plugin work drifts the codebase per-platform | Same v1/v2 discipline: platform module gates, target-gated Cargo deps, all-platform CI builds |
