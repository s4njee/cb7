# Local-first library — design

Shelf becomes a **reader that owns books**, not a client that needs a server.
The app opens to your own shelf; a CB8 server is an optional place to browse and
**download books from**. Once downloaded, a book is local — readable on a plane,
after the server dies, forever.

## Why this shape

Today the connect screen is a wall: no server, no app. That's wrong for a
reader. It also makes every read depend on the network, which is what produced
the 567 MB PDF pain — streaming a book you've "had" for weeks.

The native Flutter client (`~/cb8_flutter`) already settled this domain, and two
of its decisions are load-bearing here:

- **A `LibrarySource` interface** with local and remote implementations, so the
  UI never branches on where a book lives.
- **Store paths *relative* to the app dir.** On iOS the data-container UUID
  changes on every reinstall, so an absolute path in the catalog goes stale even
  though the file survived. This is not a style preference; it is a bug class.

## Screens

```
boot ─→ library (LOCAL, always)         ← no server required, ever
          ├── "On device"  … local books
          └── "<server>"   … browsable when connected  ──→ Download → local
        └─ reader
connect (server) is reached from the library menu, never on the critical path
```

An empty local shelf shows the empty state with actions: **Add books** (file
import), **Browse a catalog** (OPDS acquisition), and **Connect a server** —
not an error, an invitation. OPDS downloads become ordinary local copies.

## Records

`WebComicRecord` gains a discriminator:

```ts
source: "local" | "server"
```

Ids live in separate spaces (local ids are catalog-assigned), so **every API
that took a bare `id` now takes the record** (or an explicit `source`). That's
the one invasive change; it's mechanical and it makes "which shelf is this from"
impossible to get wrong.

`api.*` becomes a router: local records go to the local source (Rust commands),
server records take today's path unchanged.

## Local storage (Rust, `app_data_dir` — *not* cache)

iOS may evict the cache directory; a library must not live there.

```
<app_data>/library/
  catalog.json              the catalog (see below)
  books/<uuid>.<ext>        app-owned book files
  covers/<uuid>.jpg         extracted covers
```

`catalog.json` holds one entry per book, with **relative** paths:

```jsonc
{
  "version": 1,
  "books": [{
    "id": 3,                       // local id, monotonic
    "title": "…",
    "authors": ["…"],             // embedded creators, when available
    "description": "…",           // embedded summary/subject, optional
    "language": "en",              // embedded language, optional
    "publisher": "…",             // embedded publisher, optional
    "publishedAt": "…",            // embedded publication date, optional
    "file": "books/9f2c….epub",    // relative to <app_data>/library
    "cover": "covers/9f2c….jpg",   // relative; null until extracted
    "ext": "epub",                 // epub | pdf | cbz | cbr | cb7 | folder
    "mediaType": "book",           // book | comic
    "pageCount": 0,                // comics: page count; books: 0 until known
    "bytes": 12345678,
    "addedAt": "…",
    "origin": { "server": "http://…", "comicId": 120605 } | null,
    "progress": { "page": null, "location": null, "percent": null, "readAt": "…" }
  }]
}
```

`origin` remembers where a downloaded book came from, so the same book isn't
downloaded twice and (later) progress can sync back.

## Reading local books

| Format | How |
|---|---|
| EPUB | whole-file bytes → epub.js (as today); OPF metadata is extracted on import |
| PDF | disk byte ranges → pdf.js (the path built for the 567 MB book) |
| CBZ | **Rust unzips page N on demand** (`zip` crate); page list and ComicInfo metadata are cached |
| CB7 | **Rust reads page N on demand** (`sevenz-rust`); no sidecar or full extraction |
| Image folder | Direct image files are a comic in natural filename order; linked folders read in place, imports become CBZ |
| CBR | not supported locally (needs unrar). Say so plainly; offer the server copy when connected. |

CBZ is the one genuinely new capability: a local comic can't ask the server to
extract pages. Backlog previously said "don't unpack client-side" — that was
under a server-first model, and this design supersedes it for CBZ only.

## Covers

- **CBZ**: Rust reads the first image out of the zip.
- **EPUB / PDF**: rendered **client-side** on first open (epub.js cover, or
  pdf.js page 1 → canvas) and handed back via `save_local_cover`. This keeps
  heavy PDF/EPUB rendering deps out of Rust entirely.
- Until a cover exists, the existing typographic gradient fallback stands in.

## Getting books in

1. **Download from a connected server** — streams to `library/books/`, writes a
   catalog entry with `origin`, extracts the cover. Reuses the streaming
   download built for large PDFs (chunked to disk, never buffered).
2. **Import from Files / share sheet / Open In** — copy into `library/books/`
   (copy, so the app owns it; no security-scoped bookmarks on re-read).
   - Document types are declared in `tauri.conf.json` `bundle.fileAssociations`
     (EPUB, MOBI, AZW3, PDF, CBZ, CBR, CB7). Plain image folders are also
     accepted by the folder picker. MOBI/AZW3 files are converted to EPUB
     during import; Tauri generates `CFBundleDocumentTypes` /
     `UTExportedTypeDeclarations` for iOS and intent filters for Android.
   - `RunEvent::Opened` delivers URLs; Rust stores them for cold start
     (`take_opened_paths`) and emits `shelf://opened-files` for live opens.
   - The frontend always **copies** via `local_import`, then opens the first book.
3. **Files app visibility (iOS)** — the library root is
   `<Documents>/library` with `UIFileSharingEnabled`, so On My iPhone → CB8
   shows the shelf. Config/cookies stay in Application Support. A one-time
   migration moves an older Application Support library into Documents.

## Tauri commands (contract)

| command | args | returns |
|---|---|---|
| `local_list` | — | `LocalBook[]` (catalog, resolved) |
| `local_import` | `{ paths: string[] }` | `LocalBook[]` (added) |
| `local_delete` | `{ id }` | `bytes freed` |
| `local_download` | `{ comicId, title, ext, mediaType }` | `LocalBook` — streams from the server, emits `shelf://local-download-progress` |
| `local_file_length` / `local_read_range` | `{ id, begin, end }` | bytes — the PDF/EPUB read path |
| `local_page` | `{ id, index, width? }` | image bytes — CBZ page |
| `local_page_count` | `{ id }` | number — unzip once, cache in catalog |
| `local_set_progress` | `{ id, page?, location?, percent? }` | ok |
| `save_local_cover` | `{ id, bytes }` | ok — client-rendered EPUB/PDF cover |

Media for local books is served through the existing `cb8://` scheme under a
`/local/` path (`cb8://localhost/local/<id>/page/<n>`, `/cover`), so `<img>`
tags work unchanged.

## What this replaces

The **pinned store** (`downloads.rs`) was server→local caching of *pages*. Local
books supersede it: downloading gets you the real file, not a page cache. Pins
stay working for now, but the Downloads sheet becomes "your local books" and the
pinned tree is deprecated once local download lands.

## Deliberately out of scope (for now)

- Local CBR (unrar dependency).
- Two-way progress sync with `origin` servers — the field is recorded so it can
  be added without a migration.
- Local full-text search.
