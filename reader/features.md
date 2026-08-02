# Features Checklist — Shelf (reader client)

What a full-featured ebook/comic reader client should support, scoped to this
app (the CB8 server handles ingest/metadata/search server-side — see
`../webui/features.md` for that list). Checked items are implemented and
verified; unchecked items are the roadmap.

> **Verified against real content (2026-07-16 polish pass):** PDF rendering
> (8-page PDF with tables/figures), fixed-layout EPUB, footnote popovers,
> dictionary lookup, highlights (create → paint → persist), server-synced EPUB
> CFI bookmarks, RTL spreads, scrubbing, go-to-page, and the jump back-stack
> were all driven end-to-end against a seeded CB8 server. Still unproven on a
> physical device: immersive status-bar hiding (desktop/browser verified only).
> Known cosmetic gap: fixed-layout pages letterbox with the page's own
> background rather than the app theme on very tall viewports.

## Formats & Rendering
- [x] CBZ/CBR comics via server page API
- [x] EPUB (reflowable, epub.js, paginated columns)
- [x] **PDF rendering** (pdf.js canvas view streaming the Range-capable `/file`)
- [ ] MOBI/AZW3 (server serves the bytes; no client renderer)
- [x] EPUB fixed-layout (pre-paginated) support
- [x] EPUB scrolled flow mode (continuous vertical, like webtoon for text)
- [x] Embedded images/tables/footnote popovers inside EPUB (footnote tap-preview)
- [ ] In-book image zoom (pinch/tap to inspect an illustration)
- [x] Right-to-left page direction for manga (spread order + thumbnail strip reversed)
- [x] Double-page spread detection for wide comic pages (render landscape pages solo/fit)
- [ ] Comic panel-by-panel guided reading mode

## Reading Experience
- [x] Single / spread / webtoon layouts (comics)
- [x] Tap zones, arrow keys, swipe paging
- [x] Chrome auto-toggle on tap; side arrows; thumbnail strip
- [x] Themes (dark/sepia/light), brightness overlay, text size, line spacing, serif/sans
- [ ] Pinch-to-zoom & pan on comic pages (zoom modes: fit-width / fit-height / original)
- [ ] Page-turn animations (slide/curl/fade options)
- [ ] Volume-button page turning (Android)
- [ ] Keep-awake while reading (prevent screen sleep mid-page)
- [ ] Tap-target customization (invert zones for left-handed readers)
- [x] Margins / column-width control for text
- [ ] Hyphenation & justification toggles
- [x] More typefaces (bundled font choices beyond Literata/system, per-book override)
- [x] **Reader settings by intent** (Layout / Appearance / Navigation / Accessibility;
      format-gated controls; typography preview; reset this book vs all defaults)
- [x] True full-screen / immersive mode on mobile (hide status bar while reading)
- [ ] Screen-brightness slider driving the OS backlight (currently an overlay dim)
- [ ] Reading ruler / bionic focus aids (accessibility)

## Navigation
- [x] TOC drawer with current-chapter highlight (EPUB)
- [x] Comic thumbnail strip + progress scrubber display
- [x] Draggable progress-bar scrubbing (jump by dragging the bar)
- [x] **Scrub destination preview** (page/spread + chapter + % while dragging; live page label)
- [x] Go-to-page / go-to-percent input
- [x] Back-stack after a TOC/bookmark jump ("return to where I was")
- [x] **Return control** (labeled + pulse after deep jumps; document-order page labels in spread/RTL)
- [x] **Standardized load/offline/error states** (shared kinds + StatusView; skeleton library;
      inline page retry; blocking reader only when empty)
- [ ] In-book text search (search inside the open EPUB)
- [x] **Haptic page turns + chapter-boundary ticks** (mobile; light on a turn,
      medium on crossing a chapter, never on scrolling surfaces, toggle in
      reading settings) — policy is unit-tested, but the buzz itself is
      unproven on hardware: a simulator has no taptic engine

## Annotations & Marks
- [x] Bookmarks — comics (server-synced), EPUB (local)
- [x] **EPUB bookmarks synced to server** (CFI `location` anchors; server endpoint added to webui)
- [x] Text highlights with colors (EPUB)
- [ ] Notes attached to highlights/bookmarks
- [ ] Highlight/note export (Markdown/JSON)
- [x] Dictionary lookup on long-press
- [ ] Translate selection
- [ ] Text-selection copy/share (currently epub.js default handling, unstyled)

## Library (client-side)
- [x] Cover grid, All/Comics/Books filters, title search, continue-reading hero
- [x] Real covers with typographic fallback
- [x] Sort controls in the UI (title / recently read / date added, asc/desc)
- [x] Read-status filter chips (unread / reading / finished; signed-in only)
- [x] Favorites (heart on cards with optimistic toggle + Favorites chip)
- [x] Collections + series browsing (scope chips with breadcrumb; folder drill-down still open)
- [ ] Tag browsing (`/api/tags`)
- [x] **Book detail sheet** (cover, metadata, source, size, progress, download state,
      tags, contextual actions; open via overflow ··· / long-press / right-click / `i`)
- [x] Mark as read / unread + clear progress (book detail sheet + one-tap favorite on card)
- [x] "Up next in series" suggestion after finishing a volume (finished overlay)
- [ ] Semantic in-book search results surface (`/api/search`, needs embeddings sidecar)
- [x] Pagination beyond the 200-record first page (infinite scroll sentinel; not yet exercised against a >200-record library)
- [x] Pull-to-refresh on mobile (touch overscroll; device verification pending)

## Offline & Sync
- [x] Media disk cache (cache-first pages/covers/files → re-reads work offline)
- [x] Progress restored from server on every open (cross-device)
- [x] **Explicit downloads** — single path **Save to device** (full file → on-device
      shelf) with live progress banner + reader overlay; EPUB/PDF open also saves.
      Legacy offline pins remain listable/removable in Downloads sheet only.
- [x] **Local vs server context** (source badges on detail sheet + reader chrome; explicit Save to device / Remove local copy / Remove download labels)
- [ ] Offline library snapshot (browse the shelf without connectivity, not just media)
- [ ] Progress write queue with retry (turns made offline sync when back online)
- [ ] Conflict handling when two devices read the same book (latest-position prompt)
- [ ] Cache management UI (per-book usage, size cap setting; only "clear all" exists)
- [x] Guest-mode local progress persistence + sync-on-sign-in offer
- [x] **iOS Files / share integration** — open EPUB/PDF/CBZ/CBR via Open In or
      share sheet (copy into owned library), library under Documents with
      `UIFileSharingEnabled` so imports are visible in the Files app

## Accounts & Server
- [x] Server connect + probe, username/password sign-in, persisted session, guest mode
- [x] **LAN auto-discovery** (mDNS `_cb8._tcp`; server advertises, connect screen lists
      nearby servers as tappable cards) — verified desktop↔server on a real LAN;
      Android MulticastLock held for each browse window (DISC-5); iOS entitlements
      in place; physical Android/iOS smoke still recommended
- [x] **QR pairing** (webui "Pair a device" panel → scan on phone → connected *and*
      signed in via a single-use 2-minute token) — full loop verified server↔client;
      the camera scan itself is unproven on a physical device
- [ ] Multiple saved servers / fast server switching
- [ ] Multiple user profiles on one device
- [ ] Self-signed certificate trust flow (HTTPS with private CAs)
- [ ] OPDS catalog browsing as a secondary source (server exposes `/api/opds`)
- [ ] Change-password screen (admin creates accounts; password change is in webui only)

## Platform Integration (iOS/Android)
- [ ] Store-ready release pipeline (signing, TestFlight / Play internal track)
- [x] Tablet/phone adaptive pass (iPhone 17 Pro + iPad Pro simulators: safe-areas/Dynamic Island clean; physical-device pass still recommended)
- [ ] System dark/light "follow OS" theme option
- [ ] Text-to-speech / read-aloud (with system voices, background audio)
- [ ] Screen-reader audit (VoiceOver/TalkBack labels on all controls)
- [ ] Reduced-motion mode honoring OS setting
- [ ] Share sheet: send an EPUB/CBZ *to* Shelf → upload to server (admin)
- [ ] App shortcuts / widgets (continue-reading widget, long-press quick actions)
- [ ] Handoff/state restoration (reopen mid-book after app kill)

## Stats & Extras
- [x] Reading statistics (on-device time/pages per day, streaks, top books)
- [x] Reading history view (server history with open/close breadcrumbs + paging)
- [x] Time-left-in-book estimate (rolling pace; chapter-level still open)
- [x] Finished-book flow (favorite, implicit mark-read, jump to next in series)
- [ ] Sleep timer (auto-close after N minutes)
