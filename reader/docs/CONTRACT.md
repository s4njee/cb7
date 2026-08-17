# CB8 (reader/) — Architecture & Wire Contract

CB8 is a Tauri v2 app (Rust core + React/TS/Vite webview UI) that is a client
for a **CB8 server** (the Fastify+Postgres server in `/Users/sanjee/projects/cb7/webui`).
Deployment targets: **iOS, Android, and desktop** (macOS/Windows/Linux). The
app is **local-first** — the on-device library works with no server at all,
and connecting to a CB8 server is optional. Desktop release details live in
[plan-desktop.md](../plan-desktop.md) and
[DESKTOP.md](../DESKTOP.md).

## Platform boundary

- **Frontend platform facts** come from `src/lib/platform.ts`, resolved once
  during boot from the Rust `platform_info` command (`os`, `isDesktop`,
  `media_base`). `isTauri` also lives there. **No `navigator.userAgent`
  sniffing anywhere** — platform identity and the media protocol base are
  native values from Rust.
- **Desktop open/import pipeline** (`src-tauri/src/opens.rs`): every way a book
  reaches the app — macOS/iOS/Android `RunEvent::Opened`, Windows/Linux startup
  argv, a second single-instance forward — normalizes to a canonical supported
  book path (`file://` URL or plain path), then either queues for cold-start
  drain or emits the live `shelf://opened-files` event. A single OS open event
  goes entirely to one channel, so a path can never import twice. All paths end
  at `local_import`.

## Split of responsibilities

- **Rust (`src-tauri/`)** owns all networking: a `reqwest` client with a
  persisted cookie store (better-auth session cookie `cb8.session_token`),
  invoke commands for JSON, and a custom `cb8` URI scheme that proxies binary
  GETs (covers, page images, book files) with an on-disk LRU cache.
- **Frontend (`src/`)** never talks to the network directly in Tauri builds. It
  uses `invoke` for JSON and `cb8` scheme URLs for images/files.

## Tauri invoke commands (implemented in `src-tauri/src/commands.rs`)

| command | args | returns |
|---|---|---|
| `get_config` | — | `{ server_url: string \| null }` |
| `set_server` | `{ url }` | probes `GET {url}/api/auth/session`, persists config, returns the session JSON |
| `login` | `{ username, password }` | `POST /api/auth/login` → `{ ok: true, user: { id, username, isAdmin } }` |
| `logout` | — | `POST /api/auth/logout`, then clears local cookies |
| `api_get` | `{ path }` | JSON of `GET {server}{path}`; path must start with `/api/` |
| `api_send` | `{ method, path, body? }` | JSON of the write request |
| `clear_media_cache` | — | bytes freed |
| `haptics_supported` | — | `bool` — `cfg!(any(target_os = "android", target_os = "ios"))`, i.e. exactly where the haptics plugin is compiled in. Asked from Rust because the plugin's only "are you there?" probe is *firing a buzz*, which would vibrate the phone of someone opening settings to switch haptics off. |

Command errors are serialized as `{ status: number, code?: string, message: string }`
(`status` 0 = local/transport error, else HTTP status). Error envelope from the
server is `{ "error": "<message>" }` and is already unwrapped into `message`.

### Offline downloads ("pin this book")

Additional commands (frontend stubs already exist in `src/lib/transport.ts` —
the Rust side must match these shapes exactly; JS camelCase args map to Rust
snake_case params):

| command | args | behavior |
|---|---|---|
| `download_book` | `{ comicId, title, mediaType: 'comic'\|'book', pageCount }` | starts an async pin; returns immediately. Comics: thumbnail + every page **full-res** (no `?width`); books: thumbnail + `/file`. |
| `cancel_download` | `{ comicId }` | stops an in-flight pin; partial files kept (resume = re-run `download_book`, which skips already-present files). |
| `remove_download` | `{ comicId }` | deletes the pin directory; returns bytes freed. |
| `list_downloads` | — | `[{ comicId, title, mediaType, total, done, bytes, complete }]` (`total` = pageCount for comics, 1 for books; thumbnail not counted). |

Progress: emit the Tauri event **`shelf://download-progress`** with payload
`{ comicId, title, mediaType, total, done, bytes, complete, error? }` after
every completed unit (and once with `error` set on failure/cancel).

Storage: `app_cache/pinned/<sha256(server_url + "|" + comicId)>/` containing a
`manifest.json` (the `list_downloads` entry plus a `files` map of
`<query-stripped /api path> → <relative file name>` and `contentType` per
file) and the payload files. The pinned tree is **exempt** from the LRU
eviction and from `clear_media_cache`.

Proxy integration: on a cacheable GET, lookup order is LRU cache → pinned
(match by query-stripped path, so a width-hinted page request can be served by
the full-res pinned copy when offline) → network. Network success still writes
the LRU cache as before; a pinned hit must NOT copy into the LRU cache.
Precedence within pinned-vs-network: prefer the network when reachable for
`?width=` requests (crisper-per-byte), but serve pinned immediately for exact
path matches (no query) and whenever the network errors.

### LAN discovery (mDNS)

**Service advertisement (webui side — the wire contract):** a CB8 server
advertises service type **`_cb8._tcp.local.`** on the port it listens on, with
TXT records:

| key | value |
|---|---|
| `ver` | server package version, e.g. `1.0.5` |
| `name` | instance display name — `app_meta.server_name`, default `os.hostname()` |
| `path` | always `/api` (reserved for a future sub-path deployment) |

Opt-out: `CB8_MDNS=0`. **Default on** for bare-node, **off in the Docker
image** — a bridge-network container advertises an IP the LAN cannot reach,
which is worse than not advertising at all (host networking re-enables it).
Advertisement failure is log-and-continue, never fatal.

The Rust core browses for this service and streams results to the connect
screen.

| command | args | behavior |
|---|---|---|
| `start_discovery` | — | idempotent: starts (or keeps) a browse window. Returns immediately; results arrive as events. Auto-stops after **15 s**. |
| `stop_discovery` | — | ends the browse window early (connect screen unmount). Always succeeds. |

Event **`shelf://discovered-server`**, payload
`{ name, url, version, addr }` (camelCase):

- `name` — TXT `name`, else the mDNS instance name; display string.
- `url`  — `http://<ipv4>:<port>` built from the resolved A record + SRV port.
  **This is the identity**: de-duplicate on it, and never emit the same `url`
  twice within one browse window.
- `version` — TXT `ver`, or `""` when absent.
- `addr` — the bare resolved IPv4, for display ("192.168.1.20:4218" subtitle).

Rules: IPv4 only (link-local IPv6 confuses more than it helps); `http` scheme
assumed — a TLS server is reached by QR or manual entry; results are **not**
persisted across app runs (a stale IP is worse than a rescan); a browse that
fails to start (no multicast permission) resolves normally and simply emits
nothing — discovery is never an error path, only manual entry is mandatory.

**Android (DISC-5):** the Wi-Fi stack filters multicast unless a
`WifiManager.MulticastLock` is held. Rust acquires it for each browse window
via the in-app `multicast` plugin (`MulticastPlugin.kt` +
`android_multicast.rs`) and releases on window end (15 s auto-stop or
`stop_discovery`). Permissions: `CHANGE_WIFI_MULTICAST_STATE`,
`ACCESS_NETWORK_STATE` (install-time only). Desktop/iOS are unaffected.

Frontend stubs live in `src/lib/transport.ts` (`discoverySupported`,
`startDiscovery`, `stopDiscovery`, `onDiscoveredServer`); browser dev is a
no-op that emits nothing.

### Haptics (page turns)

Mobile-only, via `tauri-plugin-haptics`. `hapticTick(kind)` in
`src/lib/transport.ts` is **fire-and-forget and cannot fail**: a page turn never
waits on the taptic engine, and a device that cannot buzz turns pages exactly as
before. Silence is the correct failure mode for a feature you can only feel.

The policy — *when* to tick — is the pure `hapticForTurn` in `src/lib/haptics.ts`
(vectors in `haptics.test.ts`), because a haptic leaves no trace on screen and a
simulator has no taptic engine, so it cannot be checked by running the app:

- ordinary page turn → `page` (light impact)
- crossing into a different chapter → `chapter` (medium) — **supersedes** the
  page tick; one event, one feeling
- opening a book, a re-render that moved nothing, the pref being off → silence
- **any scrolling surface (webtoon, EPUB scrolled flow) → never**: there the
  page number tracks the scroll position, so ticking on it would buzz
  continuously under the reader's thumb
- chapter `null -> "ch1"` is the EPUB index finishing its build, **not** a
  crossing — both sides must be known for a chapter tick

**Capabilities**: mobile-only plugin permissions live in
`capabilities/mobile.json` (`"platforms": ["iOS", "android"]`), not in
`default.json` — naming them in a capability that also covers desktop fails the
build there, because the permission genuinely does not exist. It grants
`haptics:allow-impact-feedback` (the haptics plugin ships **no** `default`
permission set — each command is granted individually) and
`barcode-scanner:default`. Without those entries the plugin commands are denied
at runtime and the feature silently does nothing.

### QR pairing payload

One versioned string, produced by the webui pair panel, consumed by the client
scanner. **Definition (v1):**

```
cb8pair://v1?url=<urlencoded origin>[&token=<opaque>]
```

- `url` (required) — an http(s) **origin**: scheme + host + optional port, no
  path, no query, no credentials. Anything else is invalid.
- `token` (optional, v2) — opaque single-use pairing token; see below. Never
  logged, never persisted by the client.
- Unknown query params are ignored (forward compatibility); an unknown scheme
  or version is rejected with "This code isn't a Shelf pairing code."

Client parsing is the pure function `parsePairPayload(text)` in
`src/lib/pair.ts` → `{ ok: true, url, token? } | { ok: false, reason }`, with
`reason` ∈ `not-shelf | bad-version | bad-url`. Test vectors live beside it and
are mirrored in webui's `pairPayload.test.ts` — the two must not drift.

### Pair tokens (QR v2 — auth surface)

Server endpoints (webui), both **rate-limited on the login limiter**:

- `POST /api/auth/pair-token` — **signed-in only**. Mints a single-use token
  bound to the calling user. → `{ token, expiresAt }` (ISO). TTL **120 s**.
  The plaintext token exists only in this response body; the server stores
  `sha256(token)`.
- `POST /api/auth/pair` `{ token }` — **anonymous** (that's the point).
  Consumes the token (single-use, constant-time compare against the hash,
  expiry checked), establishes the standard better-auth session cookie for the
  bound user. → `{ ok: true, user }`; any failure → `401 { error: "Invalid or
  expired pairing code" }` (never distinguish "wrong" from "expired" from
  "used" — that's an oracle).

Rules: tokens are ≥ 32 bytes of CSPRNG entropy, base64url; never written to
logs or `app_meta`; consumed rows are deleted (not marked); expired rows are
swept opportunistically on mint. Pairing is unavailable to guest sessions
(minting requires a real user). A pairing QR is a **bearer secret while
valid** — the panel regenerates it on an interval and on tab focus so a stale
screenshot is useless.

## Media proxy (custom URI scheme `cb8`)

- Frontend URL base: `cb8://localhost` on macOS/iOS/Linux, `http://cb8.localhost`
  on Windows/Android. The base comes from the Rust `platform_info` command
  (`media_base`, chosen from `cfg!` at compile time) — **not** from the user
  agent. `transport.mediaUrl()` appends it to server-relative paths.
- `GET {base}{serverRelativePath}` — e.g. `cb8://localhost/api/comics/5/pages/0`.
  GET only. Path must start with `/api/`. The Rust handler forwards to the
  configured server with the session cookie, caches 200 responses for paths
  matching `/pages/`, `/thumbnail`, `/file` on disk (LRU, keyed by
  server+path+query), and replies with upstream `Content-Type` plus
  `Access-Control-Allow-Origin: *` (required for WKWebView fetch).
- Offline/cache-first: cached entries are served without hitting the network.
- **Range requests stream through, uncached.** A GET carrying a `Range` header
  is forwarded with that header and its `206` returned verbatim (Content-Range /
  Content-Length / Accept-Ranges preserved); partial bodies are never cached or
  pinned. This is what lets pdf.js page a large PDF without downloading the
  whole file — see `src/lib/pdf.ts` `RangeTransport`, which does every range
  fetch on the main thread (a worker fetch to `cb8://` never reaches the scheme
  handler) and hands pdf.js the bytes. EPUBs still whole-file fetch (they're
  small); only PDFs range-stream.
- **Local media** (`/local/<id>/<resource>`): `<id>` is parsed as `i64` and
  the resource is a whitelist of `cover | file | page/<n>` — no caller-supplied
  path is ever accepted through the scheme. Books are copied into app-owned
  storage (`<app_data>/library/books/`), so a copied book still opens after the
  original is renamed or removed (see `docs/LOCAL-FIRST.md`).

## Local library

The on-device shelf works with **no server**: books are copies in app storage,
indexed by `catalog.json` (relative paths, atomic `.tmp`+rename writes —
Windows-safe replacement semantics tested). Local commands:

| command | args | returns |
|---|---|---|
| `local_list` | — | `LocalBook[]` |
| `local_import` | `{ paths: string[] }` | `ImportReport { added, skipped, failed }` — per-file verdicts; directories and unsupported formats are skipped with a reason, a corrupt archive fails without leaving a catalog row, and one bad file never blocks the rest. |
| `local_delete` | `{ id }` | bytes freed |
| `local_download` | `{ comicId, title, ext, mediaType, pageCount }` | downloads a server book into the local library |

## OPDS catalogs (acquisition)

User-added OPDS catalogs are an acquisition source, not a second shelf. Rust
owns every request (isolated `reqwest` client, no CB8 cookie jar). Feeds are
normalized from **OPDS 2 JSON** and **OPDS 1 Atom**. Downloads stream to a
`.part` file, then land in the local library via the same catalog insert as
`local_import` (content-hash dedupe, `acquiredFrom` recorded).

Catalogs persist in `<app_data>/opds.json` (not `config.json`), so
`get_config` never serializes passwords. List commands strip the password and
return `hasAuth` instead.

| command | args | returns |
|---|---|---|
| `opds_list_catalogs` | — | `{ id, name, url, username?, hasAuth }[]` |
| `opds_add_catalog` | `{ name, url, username?, password? }` | probes the feed, persists, returns the catalog info |
| `opds_remove_catalog` | `{ id }` | — |
| `opds_browse` | `{ catalogId, href? }` | `OpdsFeed` (`href` omitted = catalog root) |
| `opds_search` | `{ catalogId, query, template }` | `OpdsFeed` (template contains `{searchTerms}` or `{query}`) |
| `opds_download` | `{ catalogId, href, title, mime?, coverHref?, progressId }` | `{ book: LocalBook, alreadyOwned }` |

`opds_download` emits `shelf://local-download-progress` with the caller-chosen
`progressId` so the existing Save-to-device banner can track it. Acquisition
URLs must be `http`/`https`; other schemes are rejected. Only EPUB/PDF/CBZ/CBR
are imported.
| `local_read_range` / `local_file_length` | `{ id, begin, end }` / `{ id }` | ranged reads for local PDFs |
| `local_page_count` / `local_set_progress` / `local_clear_progress` / `local_set_favorite` / `local_size` / `save_local_cover` | — | library bookkeeping |

Formats: EPUB, DRM-free MOBI/AZW3 (converted to EPUB at import), PDF, CBZ, and **CBR on desktop** (RAR via the `unrar` crate —
MIT/Apache wrapper around RARLAB's UnRAR C library; desktop-only Cargo `cfg`).
Comic pages are listed and extracted **on demand** through one bounded
abstraction (`local_zip::page_names` / `entry_bytes`), natural-sorted and
capped at 512 MiB per entry (decompression-bomb safe); traversal names
(`../`) are rejected.

## Desktop delivery contract

Every entry point funnels into `local_import` — picker, drag/drop,
double-click, and second-instance opens all produce the same catalog record:

- **macOS/iOS/Android**: `RunEvent::Opened` URLs → `opens::record_opens`.
- **Windows/Linux**: startup argv and single-instance forwards →
  `opens::book_args` (skips the executable, keeps only existing book files) →
  `record_opens`.
- **Cold start** queues paths until the frontend drains them once
  (`take_opened_paths`); **warm opens** emit the live `shelf://opened-files`
  event. Delivery is idempotent per OS event (one channel only), so the
  cold-start drain and a live emit can't import the same path twice.
- **While reading**: an import lands on the shelf with a toast rather than
  replacing the active session — progress is never discarded.

## CB8 REST API (verified against webui source)

Base: everything under `/api`. JSON in/out; errors `{ "error": string }`.
Default port **8008** (`CB8_PORT`); docker compose publishes **4218**.

### Auth (cookie session, better-auth under the hood)
- `GET /api/auth/session` → `{ authenticated, user: { id, username, isAdmin } | null, host, guestAccess }` — public, used as the connect probe.
- `POST /api/auth/login` `{ username, password }` → `{ ok: true, user }`; any failure → `401 { error: "Invalid credentials" }`. No Origin/CSRF requirements. Rate-limited 20/15min.
- `POST /api/auth/logout` → `{ ok: true }`.
- Cookie: `cb8.session_token` (HTTP) / `__Secure-cb8.session_token` (HTTPS), SameSite=Lax, 30-day sliding.
- **Guest mode**: when `guestAccess` is true, anonymous **GET**s succeed; every write is `401` — clients must degrade gracefully (keep progress locally).

### Library
- `GET /api/comics?search=&tag=&sortBy=title|dateAdded|fileSize|pageCount|lastRead&sortOrder=asc|desc&offset=&limit=(≤200)&mediaType=comic|book&readStatus=unread|in-progress|completed&favorites=true`
  → `{ records: WebComicRecord[], totalCount }`.
- `GET /api/comics/:id` → single record (no wrapper).
- `GET /api/continue-reading?limit=&mediaType=` and `GET /api/recently-read?...` → **bare array** of records (in-progress-only / any).
- `WebComicRecord` (exact): `{ id, title, pageCount, fileSize, dateAdded, tags: string[], lastPage: number|null (0-based), lastLocation: string|null (EPUB CFI), lastPercent: number|null (0-100, EPUB), lastRead: string|null, mediaType: 'comic'|'book', thumbnailUrl: string, fileExt: string, favorited: boolean }`.
- **There is no author/series field on the record.** UI shows `FILEEXT · N pages` style metadata instead.
- `mediaType === 'comic'` (cbz/cbr/cb7, or linked image folder) ⇒ has page images; `'book'` (epub/pdf/mobi) ⇒ has `/file`.

### Media
- Cover: record's `thumbnailUrl` (`/api/comics/:id/thumbnail?v=<ms>`), append `&width=NNN` for a resize. JPEG.
- Comic pages: `GET /api/comics/:id/pages/:index` — **0-based**, optional `?width=NNN`, `?upscale=1`. `Cache-Control: max-age=86400`. First-party SPA requests full-res (no width).
- Book file: `GET /api/comics/:id/file` — EPUB/PDF/MOBI bytes, supports Range.

### Progress (auth required; writes on every page turn is the SPA norm)
- `PUT /api/comics/:id/progress` body is a subset of
  `{ page: 0-based int (<pageCount), location: string (CFI), percent: 0-100 int, completed: bool }`
  → `{ ok: true }`. Reaching the last page auto-sets `completed`.
- `DELETE /api/comics/:id/progress` clears.
- Read back via `lastPage`/`lastLocation`/`lastPercent` on any record fetch.
- History (optional): `POST /api/history` `{ comicId, action: 'opened'|'closed', page }`.

### Bookmarks (local-first; comics, PDFs, **and** EPUB)
A bookmark is anchored by **exactly one** of `page` (fixed-layout: comics/PDFs) or
`location` (an EPUB CFI, for reflowable books). The unused field is always `null`.

The reader stores bookmarks **on the device first** (`shelf.bookmarks.v2`, keyed
by `l:<localId>` or `s:<serverUrl>:<user|guest>:<comicId>`). A signed-in session
merges the server list (union by page/CFI), POSTs local-only rows, and DELETEs
tombstones. Offline, guest, and local-only books never wait on the network.
Legacy EPUB `shelf.bookmarks.<server>.<id>` entries are imported into the store
on first list. Server API (unchanged):

- `GET /api/comics/:id/bookmarks` →
  `[{ id, page: int|null (0-based), location: string|null (CFI), note: string|null, createdAt }]`
- `POST /api/comics/:id/bookmarks` `{ page?, location?, note? }` → `201` created bookmark
  - exactly one of `page` / `location` — **neither** → `400`, **both** → `400` (ambiguous anchor)
  - `page` validated as a 0-based int `< pageCount` (as before)
  - `location` validated as a non-empty string, max 512 chars — the server stores the CFI
    opaquely and never parses it
- `PUT /api/comics/:id/bookmarks/:bookmarkId` `{ note }`, `DELETE .../:bookmarkId` → `{ ok: true }`
  - `PUT` updates **only** `note`; the anchor (`page`/`location`) is immutable
- List order: page-anchored first in ascending page order, then CFI-anchored ones
  (`NULLS LAST`), ties broken by `id`. CFIs are not ordered relative to each other —
  sort them client-side if you need reading order.
- The old localStorage workaround (`{ cfi, label, createdAt }` keyed by
  server+book id) is imported into `shelf.bookmarks.v2` and then POSTed as
  `location` when a session is available.

### Other
- `POST/DELETE /api/comics/:id/favorite`; list favorites via `?favorites=true`.
- `GET /api/tags` → `string[]`; `GET /api/libraries?mediaType=` → `[{ id, name, comicCount, mediaType }]`; `GET /api/libraries/:id/comics` → paged.
- `GET /api/series` → `[{ name, count, thumbnailUrl|null }]`; `GET /api/series/:name/comics` → bare array.
- `GET /api/search?q=` is **semantic in-book search** (needs embeddings sidecar; 503 without). Title search = `/api/comics?search=`.
- Title-browse pagination cap: `limit` ≤ 200.

## EPUB rendering (frontend)

**Experimental (`readium` branch):** the Tauri client uses **Readium TS Toolkit**
(`@readium/navigator` + `@readium/shared`). Bytes still arrive as an
`ArrayBuffer` (proxy `/file` or local download). The client unpacks the EPUB
(`lib/readiumZip.ts`) into a WebPub manifest + ZipFetcher (relative assets
rewritten to `blob:` URLs), then loads `EpubNavigator`. Position = serialized
**Locator JSON** in `lastLocation`; percent from `locations.totalProgression`.
Theming via `EpubPreferences` / Readium CSS. PDF remains pdf.js.

The first-party web SPA may still use epub.js until ported.

## Design (frontend must recreate faithfully)

Handoff bundle: `/Users/sanjee/Downloads/design_handoff_ebook_cbz_reader/`
(`README.md` = full spec with exact tokens/sizes; `Reader.dc.html` = reference
prototype logic+markup; `screenshots/`). Tablet-first, dark-by-default, three
themes (dark/sepia/light) as CSS custom properties; Literata (bundled locally,
OFL) + system sans; screens: Library "Shelf", text reader, comic reader
(single/spread/webtoon), settings drawer, TOC/bookmarks drawer. Plus one screen
the design doesn't cover: **server connect + sign-in**, styled with the same
tokens (eyebrow + Literata heading + pill inputs + accent button).

## Frontend conventions

- React 18 + TypeScript + Vite; zustand (+`persist`) for prefs/session UI state;
  `@tanstack/react-query` for server data; **no router** (view state machine like
  the prototype: `connect → library → reader`).
- Transport abstraction (`src/lib/transport.ts`): in Tauri, invoke + cb8 URLs;
  in a plain browser (no `window.__TAURI_INTERNALS__`), fall back to direct
  `fetch('/api/...', { credentials: 'include' })` and same-origin media URLs so
  the app can be developed against `vite dev` with a proxy to a local CB8
  (see `vite.config.ts` `server.proxy`). Auth in browser mode posts the same
  endpoints via fetch.
- Persisted UI prefs (zustand persist): theme, fontScale (0.8–1.5, default 1.06),
  lineHeight (1.4–2.1, default 1.72), serif (default true), brightness (0.25–1),
  comic mode ('single'|'spread'|'scroll', default 'spread').
- Page-turn keys: ←/→, Space; tap zones L/C/R (prev/toggle chrome/next).
