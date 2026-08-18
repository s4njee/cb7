---
title: Format Support
description: What CB8 can ingest and read across the server, web UI, and Flutter client
published: true
date: 2026-06-30T00:00:00.000Z
tags: cb8, formats, readers
editor: markdown
dateCreated: 2026-06-30T00:00:00.000Z
---

# Format Support

This page lists which comic and e-book file types CB8 can open, and where. It
matters because the answer differs depending on *how* you're reading: through the
server and your web browser, or through the Flutter phone/tablet app. **Skip this
unless** a file won't show up or won't open, or you're deciding what format to
store your collection in.

A quick distinction the tables below use:

- **Ingest** (also called scanning) means the server notices a file in your
  library and adds it to its catalog. It does *not* mean you can necessarily read
  it in every reader.
- **Read** means there's a built-in viewer that actually opens the file.

So a file can be ingested (it appears in your library) but still need a different
reader to open it. New terms are explained in the [Glossary](/glossary).

CB8 has two related but different sets of rules:

- The **server / web UI** scans your mounted library (the folders you've pointed
  CB8 at) and serves the reader you use in a browser.
- The **Flutter app** (CB8's native phone/tablet/Mac app) can either read from
  that server or keep its own separate library stored on the device itself.

Use this page to tell ingestion support apart from reader support.

## Server and web UI

This is what you read in a web browser, and it's what most people use. The server
recognizes exactly two comic types (`.cbz`, `.cbr`) and three book types
(`.epub`, `.pdf`, `.mobi`) — anything else won't be added to your library.

| Format | Server ingest | Built-in web reader | Notes |
| --- | --- | --- | --- |
| `.cbz` | Yes | Yes | Zip comic archive (a folder of page images bundled into one file). Requires archive tooling in server. |
| `.cbr` / `.rar` | Yes | Yes | RAR comic archive. Uses `unrar` when available, otherwise 7-Zip fallback. |
| `.cb7` / `.7z` | No | No | Not recognized by the server — repackage as CBZ. |
| `.cbt` / `.tar` | No | No | Not recognized by the server — repackage as CBZ. |
| `.epub` | Yes | Yes | Reflowable e-book (text that re-wraps to fit your screen) via epub.js. |
| `.pdf` | Yes | Yes | PDF via pdf.js in the web UI. |
| `.mobi` | Yes | Limited | Cataloged as a book, but the browser reader can't open it — prefer EPUB/PDF for reading. |
| Loose image folders | No first-class support | No | Put pages in a comic archive (a single `.cbz` file). |

The server's list of supported formats is the source of truth for the web UI: if
a file type isn't in the "Yes" rows above, the server won't ingest it. If a
supported format is in your library but fails to read, check archive tooling and
logs. See [Troubleshooting](/troubleshooting).

> **Have a `.cb7` or `.cbt` file?** Don't worry — you don't lose the comic. The
> server just doesn't read those containers, so repackage the pages into a `.cbz`
> (a plain Zip of the page images) and it'll import normally. This never changes
> your original file.

## Flutter app: server mode

When the Flutter app connects to a CB8 server, it relies on the server API:

| Format | Remote browse | Remote read in Flutter | Notes |
| --- | --- | --- | --- |
| `.cbz` / `.cbr` | Yes, if server scanned it | Comic pages stream from server | Server decodes archives and serves page images. |
| `.epub` | Yes | Downloaded to temp and read locally | Progress syncs back when signed in. |
| `.pdf` | Yes | Downloaded to temp and read locally | Uses native `pdfrx` viewer. |
| `.mobi` | May appear if server scanned it | Not a first-class Flutter reader | Convert to EPUB/PDF for the best experience. |

Guest browsing (using the app without signing in) works, but the server won't
save a guest's reading progress. Sign in to have your place synced across
devices.

## Flutter app: local on-device mode

The Flutter app's local library is smaller and intentionally mobile-first:

| Format | Local import | Local reader | Notes |
| --- | --- | --- | --- |
| `.cbz` | Yes | Yes | Pure Dart archive reader plus image viewer. |
| `.cbt` | Yes | Yes | Tar comic archive support. |
| `.pdf` | Yes | Yes | Native `pdfrx`. |
| `.epub` | Yes | Yes | epub.js in a WebView. |
| `.cbr` / `.rar` | Not yet | Not yet | Needs a native RAR decoder on-device. |
| `.cb7` / `.7z` | Not yet | Not yet | Needs native 7-Zip support on-device. |
| `.mobi` | Not yet | Not yet | Convert to EPUB/PDF. |

When importing on the device, the **Flutter local importer** (the part of the
phone/tablet app that adds files stored on the device) also reads embedded
metadata where possible. This applies only to local on-device imports, not to the
server:

- `ComicInfo.xml` inside CBZ/CBT archives.
- EPUB OPF metadata for title/author/subject/date/description.

## Image formats inside comic archives

Common formats such as JPEG, PNG, GIF, and WebP are the safest choices.

The Flutter local reader recognizes newer extensions such as AVIF and JXL so
they are not silently dropped from page listings, but decode support depends on
the image codec available in that reader path. If you need maximum compatibility,
store archive pages as JPEG, PNG, or WebP.

## Recommended library layout

For server scans, use one top-level directory per series:

```text
/comics/
  Saga/
    Saga v01.cbz
    Saga v02.cbz
  One Piece/
    One Piece v01 c001.cbz

/ebooks/
  Ursula K. Le Guin/
    The Left Hand of Darkness.epub
```

CB8 infers series grouping from folder structure and filenames during ingest.
Manual metadata edits can refine titles, series, volume/chapter, author, genre,
year, and summaries after import.
