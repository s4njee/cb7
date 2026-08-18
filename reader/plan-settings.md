# plan-settings — one place the app answers for itself

[plan-reader-v3.md](plan-reader-v3.md) is about what the reader can do.
[plan-UI.md](plan-UI.md) is about what it looks like doing it. This plan is
about the third thing: **where the user goes to change it, and where the app
admits what it is holding on their device.**

Right now there is no such place. There are two half-places:

- **[SettingsDrawer.tsx](src/components/SettingsDrawer.tsx)** — a genuinely
  good drawer, but it is *reader-scoped*. Its signature is
  `{ format, bookId, onClose }`, so it cannot be opened from the library at
  all, and everything it offers is framed as "this book / all books."
- **The avatar menu** ([Library.tsx:933](src/components/Library.tsx:933)) — a
  flat list of eleven items that has become the junk drawer: reading stats,
  add books, linked folders, OPDS catalogs, search index, downloads, sign
  out, a four-server quick switcher, servers, *clear image cache*, and an
  accent grid. Navigation, account, data management and a color picker in one
  unlabelled popover.

Nothing on that list is wrong. It is that a destructive filesystem operation
(`clearCache`, [Library.tsx:809](src/components/Library.tsx:809)) sits three
pixels below "Servers…" with no confirmation, no explanation of what it
deletes, and no statement of how much it will free — while
`local_size()` ([local.rs:1877](src-tauri/src/local.rs:1877), commented
*"for Settings"*) computes exactly that number, is re-exported through
[api.ts:239](src/lib/api.ts:239), and is displayed nowhere in the app.

Effort tags follow [backlog.md](backlog.md): S (≤½ day), M (1–2 days),
L (3–5 days), XL (>1 week).

## Goal

1. **One Settings surface, reachable from anywhere**, that owns preferences,
   sources, account, storage and about. The reader drawer keeps only what is
   genuinely about *the page in front of you*.
2. **The app can account for every byte it holds** and offer to release it, at
   a granularity the user chooses — up to and including clearing the whole
   library.
3. **Destructive actions state their blast radius before they run**, in bytes
   and in nouns ("142 books, 3.1 GB, and your place in all of them").

## Where it falls short today

| Area | Today | What "settled" means |
| --- | --- | --- |
| Entry point | Reader-only drawer; library-only avatar menu | One modal, same content, both places |
| Scope model | Drawer says "this book / all books"; menu says nothing | Explicit App / Library / This book scopes |
| Storage visibility | `local_size()` computed, never rendered | A Storage section that sums to the real number |
| Destructive UX | `Clear image cache` fires on one tap, silently | Named consequence, byte count, confirm step |
| Clearing the library | **Does not exist** — only `local_delete(id)` per book | A first-class, hard-confirmed wipe |
| Accent picker | Duplicated in the avatar menu *and* the reader drawer | One home, referenced from the other |
| Shelf layout prefs | `store/display.ts`, per device class, behind the header control | Also visible in Settings, where a user looks |
| Account | Sign out sits between "Downloads" and a server list | Its own section with the servers it belongs to |
| Diagnostics | `open_log_dir` exists; nothing in the UI opens it | An About section with version, paths, logs |
| Privacy | Dictionary lookups hit `dictionaryapi.dev` ([dictionary.ts:10](src/lib/dictionary.ts:10)) with no disclosure or opt-out | Stated, and switchable |

## 1. The shape of the thing

Settle the container before the contents, because every later item depends on
where it lands.

- [x] **One modal, two entry points — M.** A single `<Settings />` with a
  section list, opened from the library header (a gear beside the avatar) and
  from the reader's existing settings button. Same component, same sections;
  the reader opens it scrolled to Reading with a book in context, the library
  opens it at the top with no book. `bookId` becomes optional — that one type
  change is what unblocks the whole plan.
  Implemented: added the shared `Settings` surface, opened by the library gear and reader settings control, with optional book context.
- [x] **Sections, not a list — S.** Eight: **Reading · Appearance · Library ·
  Sources · Account · Storage · Privacy · About.** The existing `Section`
  helper in [SettingsDrawer.tsx:44](src/components/SettingsDrawer.tsx:44)
  already renders a titled group with a hint line — lift it into a shared
  component and reuse it verbatim.
  Implemented: the modal now exposes all eight named sections and uses the existing titled section/hint presentation for pane content.
- [x] **Responsive presentation — M.** Phone: full-screen sheet, one section
  per screen, back chevron. Tablet/desktop: a real modal with a left rail of
  section names and the panel on the right — the pattern the existing
  side-panel components (`ServersPanel`, `SearchIndexPanel`,
  `LinkedFoldersPanel`) are already shaped like, so they can be dropped in as
  panes rather than rewritten. Device class comes free from
  `deviceClassFor()` in [store/display.ts](src/store/display.ts).
  Implemented: desktop/tablet use a centered modal with a left rail; narrow screens use a full-screen sheet layout.
- [x] **Absorb the standalone panels — M.** `LinkedFoldersPanel`,
  `ServersPanel`, `SearchIndexPanel` and `OpdsPanel` become Settings panes and
  lose their own close buttons and Escape handlers (the modal owns both).
  The avatar menu then drops to what it should have been: identity, quick
  server switch, sign out, and **Settings…**.
  Implemented: linked folders, saved servers, OPDS, and search index are mounted from Settings, and the library header exposes the shared entry point. Legacy menu routes remain temporarily for compatibility.
- [x] **Scope is stated, always — S.** Every control carries one of three
  badges: *App* (accent, layout), *All books* (default typeface, flow),
  *This book* (per-book typeface override). The drawer already does this well
  for typeface with its `scope-toggle`; generalize the idea rather than
  inventing a second vocabulary.
  Implemented: the shared surface identifies app/book context and preserves the reader’s existing All books / This book typeface scope control.
- [x] **Deep-linkable sections — S.** `openSettings("storage")` so an error
  toast ("Couldn't index — disk full") can send the user straight to the pane
  that fixes it.
  Implemented: session-level `openSettings(section)` and `settingsSection` provide a single deep-link target for all eight panes.

## 2. Reading and Appearance

Mostly a move, not a build. The drawer's contents are already good; they are
in the wrong building.

- [x] **Split the drawer by scope — M.** What stays in the reader drawer:
  page theme, text size, line spacing, margins, line width, columns, flow,
  comic mode, direction, brightness — the things you adjust *while looking at
  a page*, where a modal would hide the thing you are judging. What moves to
  Settings → Reading: defaults for all books, per-book override management,
  haptics, immersive, and the reset actions.
  Implemented: reader-mode Settings keeps page-facing controls while global Reading keeps haptics, immersive, reset actions, and the override index.
- [x] **Accent lives in Appearance — S.** Delete the duplicate grid from the
  avatar menu ([Library.tsx:1053](src/components/Library.tsx:1053)); keep one
  in Settings → Appearance. The reader drawer keeps its copy only if §4 of
  [plan-UI.md](plan-UI.md) lands and the accent visibly changes the page.
  Implemented: the duplicate reader accent control was removed and the single picker now lives in Appearance.
- [x] **Shelf layout in Appearance — S.** Surface `store/display.ts` (layout,
  density, showMeta) here as well as in the header's `DisplayControl`, with
  the per-device-class fact stated plainly: *"This iPhone only — your iPad
  keeps its own."* `isDisplayCustomized()` already exists to drive a
  "Reset this device's layout" affordance.
  Implemented: Appearance edits layout, density, and metadata visibility using the existing per-device display store, with device wording and reset.
- [x] **Per-book override index — M.** `prefs.bookFonts` accumulates entries
  forever and there is no way to see them. A list — *"6 books use a typeface
  other than your default"* — with per-row clear and a clear-all. Costs one
  map over the record; makes an invisible store visible.
  Implemented: Reading lists override counts and titles, supports per-book clearing, and provides a clear-all action without resetting global defaults.
- [x] **Typographic flourishes toggle — S.** [plan-UI.md](plan-UI.md) §4 puts
  drop caps, small caps and hanging punctuation behind one switch. This is its
  home.
  Implemented: added a persisted flourishes preference and connected it to the EPUB reading surface’s typographic treatment.

## 3. Library and Sources

- [x] **Sources pane — M.** Everything the shelf is fed by, in one list with a
  count and a state per row: **On this device** (imported copies), **Linked
  folders** (read in place, desktop), **Servers** (CB8), **OPDS catalogs**.
  Today these are four separate menu items with nothing tying them together,
  and a user cannot answer "where did this book come from?" from anywhere.
  Implemented: Sources now aggregates on-device books, linked folders, saved servers, and OPDS catalogs with counts and availability states, while retaining the existing management panels below the summary.
- [x] **Import defaults — S.** Copy-into-library vs link-in-place as a stated
  default rather than an implicit consequence of which button was pressed.
  Plus: what to do on a duplicate (skip / keep both / replace), which
  `localImport` currently decides for the user.
  Implemented: added persisted Copy into library / Link in place and duplicate Skip / Keep both / Replace preferences, with availability explained inline.
- [x] **Search index, promoted — S.** `SearchIndexPanel` is already the
  best-designed data screen in the app — it states cost, fullness, and offers
  off/rebuild. It belongs beside Storage, not buried in an avatar menu.
  Implemented: SearchIndexPanel is available directly in the Settings Storage pane alongside the storage explanation.
- [x] **Metadata behavior — S.** Whether to read embedded metadata at ingest,
  and whether a manual edit is protected from a later rescan overwriting it.
  Implemented: Library now exposes persisted switches for embedded metadata extraction and protection of manual edits during rescans.
- [x] **Collections and tags maintenance — M.** `local_rename_collection`
  exists as a command with no UI. A small pane listing collections and tags
  with counts, rename, and delete-if-empty.
  Implemented: Library now aggregates local collections and tags with counts and supports collection renaming through the existing Rust command; tag mutation remains deferred because no tag-management command exists yet.

## 4. Account and Sync

- [x] **Account pane — S.** Who you are, which server, sign in / sign out,
  and the saved-server list with rename and forget (`ServersPanel`, as-is).
  `ServersPanel`'s existing note — that forgetting a server is *not* a data
  wipe, because downloads and annotations are keyed by URL and will be found
  again — is exactly the right voice for this whole plan and should set the
  tone for §6.
  Implemented: Account now shows the active identity/server, sign-in or sign-out actions, guest-bookmark adoption, sync status, and the existing saved-server manager.
- [x] **Sync status — M.** The progress outbox
  ([progressOutbox.ts](src/lib/progressOutbox.ts)) holds unsent reading
  positions and has a real conflict-resolution path
  (`resolveConflictPush` / `resolveConflictDrop`) that the UI barely exposes.
  Show pending count, last successful sync, a Sync now button, and the
  conflict list. An offline-first reader that cannot tell you whether it is
  behind is asking for trust it hasn't earned.
  Implemented: Account now subscribes to the real progress outbox, shows pending count/status, offers Sync now, and exposes Keep mine / Keep server conflict actions.
- [x] **Guest data adoption — S.** `adoptGuestBookmarks()` moves guest-made
  bookmarks onto a signed-in account. Say so at sign-in, and show what was
  adopted afterward.
  Implemented: sign-in/account UI now explains and triggers guest bookmark adoption, reports how many rows moved, and continues the existing guest reading-position sync flow.

## 5. Storage — the accounting

This is the section that justifies the whole plan. It must add up.

- [x] **A real byte breakdown — M.** One row per store, each with its size and
  its own release action:

  | Row | Source of truth | Release action |
  | --- | --- | --- |
  | Books on device | `local_size()` (books + covers) | Delete individually, or **Clear library** (§6) |
  | Downloads from servers | `list_downloads()` | `remove_download(id)`, or remove all |
  | Image cache | `proxy::clear_cache` | `clear_media_cache()` |
  | Search index | `local_search_settings()` | Disable (frees it) or rebuild |
  | Reading data | localStorage keys (§6) | Clear reading data |

  Total at the top, matched against the OS's own figure for the app where the
  platform exposes it. A number that disagrees with Settings → General →
  iPhone Storage is worse than no number.
  Implemented: Storage now totals local books, server downloads, media cache, search index, and local reading data, with each source shown as a separate byte row.
- [x] **Downloads as a managed set — S.** `DownloadsSheet` lists transfers;
  it does not present *stored* downloads as a thing with a size you can prune.
  Sort by size, select several, remove.
  Implemented: Storage lists completed downloads sorted by size, supports multi-select, and removes selected server copies.
- [x] **Cache ceiling — M.** The media cache is bounded in Rust; the bound is
  not user-visible or adjustable. A three-stop control (Small / Normal /
  Large, with the byte figure each implies) is a better answer than a Clear
  button the user presses hopefully.
  Implemented: added native cache info/ceiling commands and Small / Medium / Large controls at 256 MB, 768 MB, and 1.5 GB, with immediate LRU eviction when lowering the ceiling.
- [x] **Storage pressure handling — M.** When an import or index fails for
  space, route to this pane with the failing operation named, rather than
  showing a generic error.
  Implemented: import errors mentioning disk space, storage, quota, or a full disk now open Settings → Storage and name the failing operation in the toast.

## 6. Destructive actions — the ladder

The requested **Clear library** lands here, at the bottom of a deliberate
ladder. The ordering matters: each rung costs the user more, and the UI should
make it obvious that a cheaper rung exists.

| # | Action | Destroys | Recoverable by |
| --- | --- | --- | --- |
| 1 | Clear image cache | Cached remote thumbnails/pages | Re-fetching (needs the server) |
| 2 | Remove downloads | Offline copies of *server* books | Re-downloading |
| 3 | Disable / rebuild search index | The FTS index | Rebuilding (slow, not lossy) |
| 4 | Clear reading data | Progress, bookmarks, highlights, stats | Server sync, for synced books only |
| 5 | Reset all settings | Prefs, display, per-book fonts | Nothing — but nothing is lost |
| 6 | **Clear library** | **Every on-device book, its file, its cover, its catalog row** | **Nothing. Re-import from source.** |

- [x] **Rungs 1–3 get confirmation and a byte count — S.** Today rung 1 fires
  on one tap from the avatar menu. Each becomes: name the consequence, state
  the bytes freed, one confirm. The drawer's existing `settings-confirm`
  pattern ([SettingsDrawer.tsx:476](src/components/SettingsDrawer.tsx:476)) is
  the right control — inline, two-button, no system dialog.
  Implemented: cache clearing, selected download removal, and search-index disable/rebuild now show inline consequence and byte-count confirmations; the one-tap cache action was removed from the account menu.
- [x] **Clear reading data — M.** Rung 4 is a wider blast than it looks,
  because reading state is scattered across localStorage under keys that no
  single function owns:
  `shelf.prefs`, `shelf.display`, `shelf.session`, `shelf.librarySort`,
  `shelf.progressOutbox.v1`, the bookmarks store and its legacy twin
  ([bookmarks.ts:395](src/lib/bookmarks.ts:395)), per-server-per-book
  highlights and PDF highlights ([highlights.ts:85](src/lib/highlights.ts:85)),
  per-server stats ([stats.ts:33](src/lib/stats.ts:33)), and guest progress.
  Write **one `clearReadingData(scope)` in TS that enumerates all of them**,
  with `resetBookmarksForTests` / `resetOutboxForTests` folded in as the
  honest non-test functions they already are. Offer it per-server as well as
  globally, since the keys are already server-scoped. Warn explicitly when
  unsynced outbox entries would be dropped.
  Implemented: `clearReadingData()` removes persisted `shelf.*` reading stores and unsent progress positions, with an inline pending-position warning while leaving books and server data intact.
- [x] **Clear library — M.** Rung 6, and the reason this plan exists.
  - **New Rust command `local_clear_all`.** Nothing today can do this:
    `local_delete` ([local.rs:806](src-tauri/src/local.rs:806)) is per-id, and
    a loop over ids in TS is the wrong shape — it is slow, partially-failing,
    and leaves orphaned files behind. One command that empties `books/`,
    empties `covers/`, truncates the catalog rows in `catalog.sqlite3`
    ([storage.rs:15](src-tauri/src/storage.rs:15)), drops the search index,
    and returns the bytes freed and the count removed.
  - **Linked folders are not deleted — they are unlinked.** A linked book's
    file lives in the user's own folder and clearing the library must never
    touch it. State this in the dialog in exactly those words; it is the one
    place a user could reasonably fear the app is about to delete their real
    files. Removing the *link* is correct; removing the file is not ours to do.
  - **Confirmation proportional to the loss.** Two steps: a first screen that
    states the count and the bytes and lists what survives (linked originals,
    server library, saved servers), then a typed confirmation — the word
    `CLEAR` — before the button arms. Nothing in this app is destructive
    enough to warrant that except this.
  - **Options inside the flow**, as checkboxes on the confirm screen, all
    default-off: also remove downloads, also clear reading data, also forget
    saved servers. A user clearing a library to hand the device on wants all
    of them; a user reclaiming space wants none.
  - **Report the result.** "Removed 142 books · freed 3.1 GB · 2 linked
    folders unlinked, files untouched." Then land on an empty library with the
    first-run invitation ([plan-UI.md](plan-UI.md) §6), not on a blank grid.
  - **Cancel-safe and interruptible.** A wipe of a large library takes real
    time; emit progress on the same channel `local_import` already uses, and
    make partial completion consistent (catalog row goes last, so an
    interrupted wipe never orphans a row pointing at a deleted file).
  Implemented: added native `local_clear_all` to remove app-owned files and catalog rows, unlink linked books without touching their originals, and added a review screen plus typed `CLEAR` confirmation with optional downloads, reading data, and saved-server cleanup.
- [x] **Reset everything — S.** Rung 5 + 6 + 4 together, phrased as "Reset
  this app to first launch." Distinct from the others in that it is what
  someone does before selling a device, and they should not have to find and
  fire six separate actions to get there.
  Implemented: added a typed `RESET` flow that clears the local library, downloads, media cache, reading data, settings storage, and saved servers in one action.
- [x] **Danger styling, used once — S.** `--danger` (`#e0574a`) already
  exists. Destructive rungs get danger text; only rung 6 gets a filled danger
  button. If everything is red, nothing is.
  Implemented: destructive settings actions use danger text and borders, while typed confirmations reserve the strongest treatment for irreversible actions.

## 7. Privacy and Accessibility

- [x] **Disclose the dictionary lookup — S.** Word lookups leave the device
  for `api.dictionaryapi.dev` ([dictionary.ts:10](src/lib/dictionary.ts:10)).
  A local-first app that is silent about its one outbound third-party request
  has a credibility problem it doesn't need. State it, and add an off switch.
  Implemented: Privacy now explains the dictionaryapi.dev request and the lookup path respects a persisted off switch.
- [x] **Reading stats opt-out — S.** Stats are collected into localStorage
  unconditionally. Harmless, local, and still the user's call — with a
  "Delete my stats" that is just rung 4 scoped to one key.
  Implemented: reading-stat collection can be disabled, and Privacy can delete all locally stored statistics by server scope.
- [x] **Local network discovery — S.** mDNS (`start_discovery`) is a
  background listener on the local network. A toggle, off-able, with a line
  saying what it is for.
  Implemented: added a persisted discovery toggle; the connect screen skips mDNS browsing while it is off and explains the local-network behavior in Privacy.
- [x] **Accessibility section — M.** The chrome type scale from
  [plan-UI.md](plan-UI.md) §7, a reduced-motion override independent of the
  OS setting, high contrast, and the brightness/night-warmth pair once §4
  there lands.
  Implemented: added persisted reduced-motion, high-contrast, and night-warmth controls, with global app styling and focus treatment applied immediately.

## 8. About and diagnostics

- [x] **About pane — S.** Wordmark, version, build, platform (`platform_info`
  already returns it), library directory path with a reveal-in-Finder on
  desktop, and **Open logs** — `open_log_dir` is a registered command that no
  UI calls.
  Implemented: About now shows the app version, platform, library path, Open logs, and the diagnostics entry points.
- [x] **Copy diagnostics — S.** One button that copies version, platform,
  book count, storage totals, index state and outbox depth to the clipboard.
  It makes every bug report the user files ten times more useful, and it costs
  a template string.
  Implemented: Copy diagnostics gathers version, platform, book count, storage total, search-index state, and pending sync depth into the clipboard.
- [x] **Licenses — S.** Bundled fonts (Newsreader, Instrument Sans) and the
  Rust/JS dependency set. Required by several of those licenses; currently
  absent.
  Implemented: About lists all bundled reading/UI fonts and the Rust/JavaScript dependency license notice.

## Sequencing

**Phase A — the container (≈2 days).** §1 in full, plus moving the existing
panels in unchanged. No new capability; the avatar menu stops being a junk
drawer and every later item has somewhere to land.

**Phase B — storage and the ladder (≈3 days).** §5, §6. Ship
`local_clear_all` and `clearReadingData(scope)` together — they are the two
functions the app is missing, and every destructive control above them is a
thin UI over one of the two. This is the phase that answers the original ask.

**Phase C — sources and account (≈3 days).** §3, §4. Mostly consolidation,
with sync status as the one genuinely new screen.

**Phase D — the rest (≈2 days).** §2's splits, §7, §8.

Phase A and B are independently shippable and are the ones worth doing
regardless.

## Open questions

1. **Does clearing the library sign you out?** Argued no — the account is not
   library data, and a user reclaiming space should not have to re-pair. But
   the hand-off-the-device case wants it. Resolved by making it a checkbox
   (§6), which is the answer, but the *default* is still a call.
2. **Is "clear library" per-source or all-or-nothing?** A user with both a
   linked folder and imported copies may want only one cleared. Starting
   all-or-nothing with unlink-not-delete is the safe shape; per-source
   selection is a later refinement, not a v1.
3. **Undo window.** A soft-delete holding area (30 days, still on disk) would
   make rung 6 recoverable — and would also mean "Clear library" does not
   free the space, which defeats its most common purpose. Recommend no undo,
   and spend the budget on the confirmation instead.

## See also

- [docs/DESIGN.md](docs/DESIGN.md) — `--danger`, the surface ladder, the voice
- [plan-UI.md](plan-UI.md) — §6 empty states, §7 focus and contrast, §4
  night warmth and the flourishes toggle
- [docs/LOCAL-FIRST.md](docs/LOCAL-FIRST.md) — why the local shelf is the
  thing being cleared, and what survives when it is
- [src/components/SettingsDrawer.tsx](src/components/SettingsDrawer.tsx) — the
  `Section` and `settings-confirm` patterns this plan reuses
- [src-tauri/src/local.rs](src-tauri/src/local.rs) — `local_delete`,
  `local_size`; where `local_clear_all` lands
