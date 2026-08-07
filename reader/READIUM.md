# Experimental: Readium TS Toolkit EPUB engine

This branch (`readium`) replaces **foliate-js / epub.js** with **[Readium TS Toolkit](https://github.com/readium/ts-toolkit)** in the Tauri reader.

## Packages

- `@readium/navigator` — `EpubNavigator`
- `@readium/shared` — `Publication`, `Manifest`, `Locator`, `Fetcher`
- `@zip.js/zip.js` — client-side EPUB unpack

## Architecture

Readium Web expects a **Web Publication Manifest** + fetchable resources (Thorium uses a Go streamer). CB8’s client opens raw `.epub` files, so we:

1. Load EPUB bytes (`lib/epub.ts` / local download).
2. Unpack with zip.js and build an RWPM (`lib/readiumZip.ts`).
3. Serve resources through a **ZipFetcher**, rewriting relative CSS/img URLs to `blob:` URLs so iframe content works without a network streamer.
4. Drive `EpubNavigator` (`lib/readiumView.ts` + `TextReader.tsx`).

Progress is stored as **serialized Locator JSON** in `lastLocation` (not epub.js CFI).

## PDF

Still **pdf.js** (`PdfReader`). Readium Web does not yet ship a production PDF navigator.

## Not done / follow-ups

- Readium **Decorator API** for real in-book highlights (drawer storage is wired; paint is stubby)
- Footnote / dictionary popovers (DOM wiring from epub.js era not fully ported)
- Positions list finer than one locator per spine item
- Server-side expanded WebPub streamer (would replace ZipFetcher for online books)

## Run

```sh
cd reader
pnpm install
pnpm tauri ios run --release "M2 air"   # or: pnpm tauri dev
```
