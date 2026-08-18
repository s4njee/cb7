# CB8

CB8 is a self-hosted comic and book ecosystem designed for libraries you already own. Point the server at your existing directory of `.cbz`, `.cbr`, `.cb7`, `.epub`, `.pdf`, or `.mobi` files, and it builds a fast, searchable, metadata-rich catalog over them without ever moving, modifying, or renaming the original files.

This monorepo contains the complete CB8 platform:
1. **[CB8 Server & Web UI](server/)** — A high-performance Fastify backend + Postgres/pgvector catalog + pg-boss background worker + responsive React SPA.
2. **[CB8 Reader App](reader/)** — A local-first, multi-platform native reader for **iOS, Android, macOS, Windows, and Linux** built with Tauri v2, Rust, React, and Readium.

---

## Screenshots

| **Library & Shelf** | **Comic & Manga Reader** |
|:---:|:---:|
| ![Library Shelf](docs/screenshots/library.png) | ![Comic Reader](docs/screenshots/reader-comic.png) |

| **Reflowable EPUB Reader** | **Typography & Theming Options** |
|:---:|:---:|
| ![EPUB Reader](docs/screenshots/reader-epub.png) | ![Reader Settings](docs/screenshots/reader-epub-options.png) |

| **Table of Contents & Bookmarks** | **Watched Folders & Library Admin** |
|:---:|:---:|
| ![Table of Contents](docs/screenshots/reader-toc-gutenberg.png) | ![Watched Folders](docs/screenshots/watched-folders.png) |

---

## System Architecture

```
                                  CB8 Monorepo
   ┌───────────────────────────────────┴───────────────────────────────────┐
   │                                                                       │
   ▼                                                                       ▼
[ server/ ] — Server & Web UI                           [ reader/ ] — Native Multi-Platform App
 • Fastify HTTP API (Node 20+)                          • Tauri v2 (Rust Core + React 18 Webview)
 • Durable Background Worker (pg-boss)                  • Targets: iOS, Android, macOS, Win, Linux
 • Postgres + pgvector Database                         • Local-first: on-device library & offline mode
 • React 18 + Vite + Tailwind + shadcn/ui               • Readium TS Toolkit (EPUB) + pdf.js (PDF)
 • Ingest pipeline (7-Zip, yauzl, Sharp)                • Virtualized comic reader (single / spread / webtoon)
 • OPDS 2.0 server & WebPub manifests                   • mDNS LAN discovery & 1-tap QR camera pairing
 • mDNS server broadcast (`_cb8._tcp.local.`)           • OPDS 1 / 2 catalog acquisition client
 • Optional AI: pgvector FTS search & ESRGAN            • Custom `cb8://` scheme with 768MB LRU cache
```

### Request & Sync Flow

```
┌─────────────────────────┐          ┌─────────────────────────┐
│     Desktop / Mobile    │          │     Web Browser SPA     │
│   Native Reader (Tauri) │          │       (React 18)        │
└────────────┬────────────┘          └────────────┬────────────┘
             │                                    │
             │ HTTP / JSON API + Cookies          │ HTTP / JSON API + Cookies
             │ Custom cb8:// Media Scheme         │ Same-Origin Asset Streams
             ▼                                    ▼
    ┌──────────────────────────────────────────────────────────┐
    │          CB8 API Server (dist/standalone.mjs)            │
    │  Fastify 5 • better-auth • In-Memory Archive Cache       │
    └─────────────┬───────────────────────────────┬────────────┘
                  │                               │ Enqueues Ingest & Scans
                  │ SQL Queries                   ▼
                  │                    ┌─────────────────────────────────────┐
                  │                    │   CB8 Worker (dist/worker.mjs)      │
                  │                    │   pg-boss queue • FolderScheduler   │
                  │                    └──────────────────┬──────────────────┘
                  ▼                                       │ Drains Scans
    ┌─────────────────────────────────────────────────────▼──┐
    │            PostgreSQL 16 (pgvector enabled)            │
    │  Catalog • Users & Sessions • Progress • Vector Embeds  │
    └────────────────────────────────────────────────────────┘
```

---

## Key Features

### 📚 Universal Format Support
- **Comics & Manga:** `.cbz`, `.cbr`, `.cb7`, and raw image folders. Natural filename sorting (`page2.jpg` before `page10.jpg`), single-page, two-page synthetic spreads, and vertical webtoon continuous scroll. Right-to-Left (RTL) reading mode with width-hinted responsive rendering.
- **E-Books:** Reflowable and fixed-layout `.epub` powered by Readium TS Toolkit and epub.js. DRM-free `.mobi` and `.azw3` automatic import conversion. High-quality typography (Newsreader, Instrument Sans, Atkinson Hyperlegible, OpenDyslexic, EB Garamond) and customizable margins, line-height, and themes (Dark, Sepia, Light).
- **PDFs:** PDF streaming via pdf.js with HTTP `Range` request support, allowing instant navigation across gigabyte-scale documents without full downloads.

### ⚡ Non-Destructive Ingest & In-Place Cataloging
- Files are parsed directly where they sit. Deleting an item removes its catalog entry, never your underlying files.
- **Watched Folders & Background Scheduling:** Configure server directories once, and the background worker periodically monitors and scans for dropped files incrementally.
- High-throughput background thumbnail extraction with `sharp` and parallel worker pipelines.

### 📱 Local-First Native Client (Tauri v2)
- **Zero Server Requirement:** Works as a standalone, offline desktop and mobile reader. Import books via file picker, drag-and-drop, iOS Share Sheet / Files app, or OS file association.
- **Offline Pinned Downloads:** Download books from your CB8 server directly to on-device storage with progress indicators.
- **Hearth Noir Design System:** Tailored warm near-black reading palette (`#0d0b0a`) with 6 switchable warm accents, bundled offline fonts, haptic feedback on page/chapter turns (mobile), and auto-hiding immersive reading chrome.

### 🔗 Zero-Config LAN Discovery & Secure QR Pairing
- **mDNS Auto-Discovery:** Servers advertise via `_cb8._tcp.local.`; native clients automatically discover servers on the local Wi-Fi without entering IP addresses.
- **Instant QR Pairing:** Mint single-use, 120-second cryptographic tokens from the web UI. Point your mobile camera at the screen to pair and sign in instantly without typing passwords.

### 🔍 Semantic AI Search & HD Upscaling
- **Hybrid Vector + Full-Text Search:** Combines Postgres full-text search with pgvector cosine similarity (via optional TEI embeddings sidecar) to search text *inside* e-books with Reciprocal Rank Fusion (RRF).
- **HD Comic Upscaling:** Optional Real-ESRGAN sidecar integration with local disk caching for super-resolution page rendering.

### 🌐 Open Standards & Multi-User
- **OPDS 2.0 & Readium WebPub:** Built-in OPDS feed (`/api/opds`) and WebPub manifests (`/api/comics/:id/manifest`) for interoperability with external readers (Thorium, Panels, Chunky, etc.).
- **OPDS Acquisition Client:** Native reader can browse and download from external feeds (Standard Ebooks, Project Gutenberg, Calibre-Web).
- **Multi-User & Guest Mode:** Multi-user accounts with per-user progress and bookmarks, admin controls, and safe guest browsing.

---

## Quick Start

### 1. Run the Server (Docker Compose)

The easiest way to get the CB8 server and worker running with Postgres and pgvector:

```bash
cd server/packaging/docker

# Generate secret environment variables (.env)
./cb8-init.sh

# Start Postgres, API Server, and Background Worker
docker compose up -d --build
```

- Open `http://localhost:4218` in your browser.
- The initial admin password is printed to stdout and visible in logs (`docker compose logs cb8`). Sign in and configure your library folders in **Settings → Watched Folders**.

### 2. Run the Server (Standalone Node)

Requires Node.js 20+, pnpm 11+, and a PostgreSQL instance with the `vector` extension enabled:

```bash
cd server
pnpm install

# Build frontend and compile standalone server & worker bundles
pnpm build:standalone

# Run the API server
DATABASE_URL=postgres://cb8:password@localhost:5432/cb8 node dist/standalone.mjs

# Run the background worker (in a separate terminal)
DATABASE_URL=postgres://cb8:password@localhost:5432/cb8 node dist/worker.mjs
```

### 3. Run the Native Reader App (Tauri v2)

Requires Rust stable, Node.js 20+, and platform development dependencies:

```bash
cd reader
pnpm install

# Run as desktop app (macOS / Windows / Linux)
pnpm tauri dev

# Run in browser against a local server (fast frontend loop)
CB8_SERVER=http://localhost:4218 pnpm dev

# Run on iOS Simulator (macOS host with Xcode)
pnpm tauri ios dev

# Run on Android (with Android Studio / NDK)
pnpm tauri android dev
```

---

## Repository Structure

```
cb7/
├── server/                          # CB8 Server & Web UI (Fastify + Postgres + React)
│   ├── src/
│   │   ├── main/                   # Node.js backend: DB, ingest, routes, jobs, search
│   │   │   ├── db/                 # Postgres connection pool & domain schemas (pgvector)
│   │   │   ├── jobs/               # pg-boss queue handlers & producer
│   │   │   ├── webServer/          # Fastify routes, auth (better-auth), archive cache
│   │   │   ├── standalone.ts       # API server entrypoint
│   │   │   └── worker.ts           # Background worker entrypoint
│   │   ├── renderer/               # React 18 SPA (Vite + Tailwind + shadcn/ui)
│   │   └── shared/                 # Shared TypeScript types and validators
│   ├── packaging/                  # Deployment recipes: Docker, Kubernetes, Argo CD, Systemd
│   ├── docs/                       # Server technical docs, diagrams, and onboarding guides
│   └── package.json
│
├── reader/                         # CB8 Native Reader (Tauri v2 + Rust + React)
│   ├── src/                        # Frontend UI (React 18, Readium, pdf.js, Zustand)
│   ├── src-tauri/                  # Rust Core (Reqwest cookie jar, cb8:// scheme, local library)
│   │   ├── src/                    # Commands, catalog index, ZIP extraction, mDNS
│   │   └── Cargo.toml
│   ├── docs/                       # Reader specifications, wire contracts, and design tokens
│   └── package.json
│
└── .github/
    └── workflows/                  # GitHub Actions CI/CD workflows
        ├── ci.yml                  # WebUI test & Postgres-gated suite
        ├── reader-ci.yml           # Reader frontend & Rust clippy/fmt/tests
        └── reader-release.yml      # Multi-platform desktop & mobile release builder
```

---

## Documentation Map

Detailed documentation is available across both sub-projects:

### Server & Web UI (`server/`)
- [server/README.md](server/README.md) — Server overview, features, and configuration.
- [server/ARCHITECTURE.md](server/ARCHITECTURE.md) — Deep architectural walkthrough: request lifecycle, auth, job queues, and database schemas.
- [server/DEPLOY.md](server/DEPLOY.md) — Production operations guide (k3s Kubernetes, Argo CD GitOps).
- [server/docs/DEPLOYMENT.md](server/docs/DEPLOYMENT.md) — Environment variables, Docker Compose, and bare-metal setup.
- [server/docs/QR-PAIRING.md](server/docs/QR-PAIRING.md) — Specification and implementation details of QR device pairing.
- [server/docs/STUDY_GUIDE.md](server/docs/STUDY_GUIDE.md) — Codebase onboarding guide and module map for developers.
- [server/docs/READER.md](server/docs/READER.md) — Web reader UI controls, shortcuts, and behavior.
- [server/docs/diagrams.md](server/docs/diagrams.md) — Mermaid diagrams for ingest, page retrieval, and API flows.
- [server/CONTRIBUTING.md](server/CONTRIBUTING.md) — Development conventions and guide for adding features.

### Native Reader App (`reader/`)
- [reader/README.md](reader/README.md) — Native reader overview, prerequisites, and build commands.
- [reader/DESKTOP.md](reader/DESKTOP.md) — Desktop-specific features, file associations, shortcuts, and log locations.
- [reader/docs/CONTRACT.md](reader/docs/CONTRACT.md) — Wire contract, Tauri invoke commands, QR format, and mDNS discovery.
- [reader/docs/DESIGN.md](reader/docs/DESIGN.md) — *Hearth Noir* visual identity, color palettes, typography, and radii specs.
- [reader/docs/LOCAL-FIRST.md](reader/docs/LOCAL-FIRST.md) — Local storage architecture and on-device catalog design.
- [reader/READIUM.md](reader/READIUM.md) — Readium TS Toolkit integration and EPUB rendering architecture.
- [reader/DEPLOYMENT.md](reader/DEPLOYMENT.md) — Mobile deployment instructions for physical iOS and Android hardware.

---

## Development & Testing

### Running Tests

#### Server & Web UI:
```bash
cd server
pnpm typecheck
pnpm test

# Run Postgres-backed integration tests (requires pgvector test DB)
CB8_TEST_DATABASE_URL=postgres://postgres:test@localhost:5432/cb8_test pnpm test
```

#### Native Reader:
```bash
cd reader
pnpm typecheck
pnpm test

cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

---

## License

This project is licensed under the [MIT License](server/LICENSE).
