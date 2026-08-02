---
title: Usage
description: First run, adding libraries, reading, clients, search, and backups
published: true
date: 2026-07-06T00:00:00.000Z
tags: cb8, usage, guide
editor: markdown
dateCreated: 2026-06-30T00:00:00.000Z
---

# Usage

This is the everyday guide to actually *using* CB8 once it's set up: how to sign
in the first time, how to point it at your comics and books, how to read them,
and how to keep a backup so you never lose your place. It's written for the
person running their own copy of CB8 at home — you don't need to be technical to
follow it, though a few steps involve copying and pasting a command. **Skip the
optional sections** (search, HD upscaling) unless they sound useful to you.

A couple of words you'll see throughout, explained once here (all terms are in
the [Glossary](/glossary)):

- **Admin** — an account that can add libraries, manage users, and change
  settings. CB8 creates the first one for you on first run; that admin can
  create more accounts (admin or regular) later.
- **Library path** — a folder on your computer where your comics or books already
  live. You tell CB8 where to look; it reads from there and never moves anything.
- **Worker** — a background helper process that does the slow work (scanning your
  folders, building the catalog). It runs alongside the main server.
- **Guest** — someone browsing without signing in. Guests can read, but their
  progress isn't saved.

This page walks through running CB8 day to day once it's installed: signing in
for the first time, creating accounts, pointing it at your library, reading in
the browser, pairing the Flutter app (CB8's phone/tablet app) or any OPDS
reader app, the optional search and upscaling features, and keeping good
backups.

If CB8 isn't running yet, start with [/installation/docker](/installation/docker)
(or the Kubernetes / bare-metal pages linked from there). Every environment
variable mentioned below is documented in full on the
[Configuration](/configuration) page, and for the big picture see
[/home](/home).

## First run and the admin account

The very first time CB8 starts, it creates one account for you — the **admin**
(the main account that controls everything) — and makes up a random password for
it. That password is printed to the server's log output (its "stdout", the text
it prints as it runs) the moment it starts up. You'll see a boxed banner that
looks like this:

```
============================================================
[CB8] Initial admin account created.
      username: admin
      password: <random 24-char string>
      Sign in and change this password immediately.
============================================================
```

You should see your username (`admin`) and the password on the lines inside that
box. Copy the password somewhere safe — you'll need it to sign in.

The same password is also stored in the database (under `app_meta`) and stays
visible in **Settings → Temporary password** until you change it — at which
point CB8 wipes the stored copy. So even if you miss it in the logs, you can
read it from the UI once you're in.

### Retrieving the password

**Docker Compose** — read the main server's logs:

```bash
docker compose logs cb8
```

You should see the boxed banner above somewhere in the output, with the admin
password inside it. (From outside the `packaging/docker` directory, add
`-f packaging/docker/docker-compose.yaml`, or use `docker logs cb8` against the
container name directly.)

**Kubernetes** — read the server's logs in the `cb8` namespace:

```bash
kubectl -n cb8 logs deploy/cb8
```

Again, look for the boxed banner with the password. If it has scrolled out of
view, don't worry — the password is also waiting for you in **Settings →
Temporary password** after you sign in.

> **Change it immediately.** The generated password is fine for a first sign-in,
> but rotate it the moment you're in. As soon as you set a new password, CB8
> clears the stored copy — see [Resetting the admin password](#resetting-the-admin-password)
> below for what to do if you lose it after that point.

Open `http://<host>:4218/` (the default published Docker port; the container
itself listens on `8008` — see [Configuration](/configuration) for the
`CB8_PORT` / `CB8_PUBLISH_PORT` distinction) and click the **Sign in** button
at the top right — it takes you to the sign-in page. Once you're signed in,
that button is replaced by your **user chip** (a little circle with your
initials); clicking it opens a menu with **Settings**, **User management** (for
admins), and **Sign out**.

## Accounts and guests

There is **no public sign-up** — CB8 is built for a household, not the open
internet. The admin creates every account: click your user chip → **User
management**, enter a username and password, and hand them to the person.
(Accounts are username-only; CB8 doesn't ask for an email address.) Admins can
also reset anyone's password or delete accounts from the same page. If someone
forgets their password, the "Forgot password?" link on the sign-in page simply
tells them to ask an admin — the server doesn't send reset emails.

People *without* an account can still browse and read as **guests** (this is on
by default; an admin can turn it off under **Settings → Guest access**). The
only thing guests give up is memory: reading progress, favorites, and bookmarks
are saved per **signed-in** user, so guests start every book from the beginning.

## Adding libraries

This is how you get your collection into CB8. The reassuring part first: **CB8
never moves, renames, or rewrites your files** — it only reads them. You tell the
server which folders your comics and books already live in (your **library
paths**), register those folders in the web UI, and CB8 builds a catalog over
them in place. Your originals stay exactly where they are.

### 1. Mount your folders into the server

The Docker Compose stack mounts two host directories **read-only** into both the
API and the worker containers, as `/comics` and `/ebooks`:

```bash
# in packaging/docker/.env
CB8_COMICS_PATH=/mnt/raid6/comics
CB8_EBOOKS_PATH=/mnt/raid6/ebooks
```

Mounting read-only is the safe default — CB8 only ever reads from these paths.
(On Kubernetes the equivalent paths come from the volume mounts in the
manifests.)

### 2. Register the paths in the UI

Sign in as the **admin**, then click the **+** button in the top bar and choose
**Add from server path** (the other choice, **Upload files**, sends files from
your device to the server instead). Enter `/comics` or `/ebooks` — the paths as
the server sees them inside its container, not the original host paths; the
path field suggests server folders as you type. Adding a
folder kicks off a scan of everything under it, and the panel shows the scan's
progress as it runs.
Folders are scanned including all their sub-folders ("recursively"), and the
first sub-folder under each library root becomes the series name — so a layout
like `/comics/Saga/Saga v01.cbz` groups into a "Saga" series automatically.

You should see covers begin appearing in the library grid as the scan progresses;
a large collection can take a while the first time, which is normal.

### 3. Scans run in the worker

The main server only adds scan jobs to a to-do list ("enqueues" them); the
separate **worker** process (`dist/worker.mjs`, the `cb8-worker` container /
Deployment) is what actually works through that list and does the scanning.
**The worker must be running for libraries to scan** — if you start only the main
server, your folders get registered but nothing gets added to the catalog. The
to-do list lives in the database (Postgres), so an interrupted scan picks back up
after a restart, and re-running a scan never creates duplicate entries.

Auto-rescan keeps the catalog fresh: the worker re-enqueues a scan per folder on
an interval, so newly added files get picked up without manual intervention.

### Supported formats

The single source of truth for what CB8 ingests is the server's media-type
definition. The scanner, the drag-and-drop validator, and the file picker all
read from it:

| Type | Extensions | Reader |
| --- | --- | --- |
| **Comics** (page-image archives) | `.cbz`, `.cbr` | Comic reader |
| **E-books** (documents) | `.epub`, `.pdf`, `.mobi` | EPUB / PDF reader |

CBZ/CBR archives are read through a native 7-Zip binary (`node-7z`). Docker
images bundle it; bare-metal installs need `7z` on `PATH` or `CB8_SEVENZIP_PATH`
set (see [Configuration](/configuration)).

> **A note on MOBI:** `.mobi` files are recognized and ingested as books (CB8
> extracts a cover and catalogs them), but the built-in browser readers cover
> comics, **EPUB**, and **PDF**. Keep e-books you want to read in the browser as
> EPUB or PDF.

## Reading in the web UI

The web UI is the same React app in every browser pointed at the server —
laptop, phone, or tablet all get the identical experience, laid out for their
screen size.

**The home page picks up where you left off.** The first thing you see is a
big **Continue reading** card — the book you most recently had open, with its
progress bar — and an **Up next** row of your other in-progress books, then the
library grid below. Cards are deliberately quiet: instead of colored format
badges each cover carries a small caption — "Page 12 of 224" or "43% read" for
books in progress, "CBZ · 24 pages" for unstarted ones — and finished books dim
slightly and get a checkmark.

**Getting around.** On a desktop-sized window there's a sidebar with your
library views (All Books, Recently Read, Continue Reading), collections,
folders, and tags. On a phone, the bottom bar has three tabs — **Home**,
**Browse** (opens a sheet you can pivot between Collections, Folders, and
Tags), and **Settings**. Two power shortcuts on desktop: press **⌘K** (or
**Ctrl+K**) for a command palette that jumps to any book, collection, folder,
tag, or action by typing a few letters, and press **/** to focus the search
box. Removing an item from the library only drops its catalog row; the file on
disk is untouched.

**Opening an item.** Click a cover to open it. CB8 picks the reader from the
file's type. All three readers share the same **immersive** behavior: the
toolbar hides itself as soon as the book opens so nothing sits over the page,
**tapping or clicking the center of the page brings it back**, and it slips
away again after about three seconds of inactivity. `Escape` takes you back to
the library and `f` toggles fullscreen, in every reader.

- **Comic reader** (CBZ/CBR) — a full-screen page view. It supports
  **single-page or two-page spreads** and **left-to-right or right-to-left**
  paging (for manga). Pages decode on demand and are cached, so nothing is
  unpacked to disk ahead of time. On touch you get pinch / pan / swipe; on
  desktop, arrow keys / space page through, `B` bookmarks, `S` toggles the
  spread, and `+` / `-` / `0` zoom. Image entries inside an archive are sorted
  with natural filename ordering (`page2.jpg` before `page10.jpg`).
- **EPUB reader** — reflowable text rendered with epub.js, with a light / dark
  theme toggle, adjustable font size, and font choices. Your position is saved
  as an EPUB location so you resume exactly where you left off, and the footer
  shows how far you are through the **whole book** ("43% read"), not just the
  current chapter.
- **PDF reader** — rendered with pdf.js; progress is saved as a page index.

Reading position is tracked **per signed-in user**, so the Continue reading
card and resume-from-last-page follow you across any browser (and the Flutter
app) pointed at the same server.

## The Flutter client (server mode)

CB8 also has a native **Flutter app** for iOS, Android, and macOS. It's
*hybrid*: it can keep a library entirely on-device, **or** point at your
self-hosted server and read the whole remote library — and the UI never branches
on which is live. See the client's
[`README.md`](https://github.com/s4njee/cb8_flutter) for the app side; the part
that matters for the server is below.

### Pointing the app at your server

In the app, switch from *this device* to a server and enter the server URL,
e.g.:

```
http://host:4218
```

Use the same host:port you reach the web UI on (the default published Docker port
is `4218`).

**Guest browsing vs. signing in.** Against a server, the app supports **guest
browsing** — guests can browse and read. To have the server **save your reading
progress**, sign in; the app shows a guest badge and a one-tap sign-in prompt
when a server requires auth to write. Once signed in, reading position syncs back
to the server and follows you across devices.

> **Trusted origins are required for login.** Better-Auth rejects sign-ins from
> any origin not in `BETTER_AUTH_TRUSTED_ORIGINS`. This must include **every**
> origin the app (and browsers) reach the server by — each `host:port`
> combination: the LAN IP, the hostname, the `.local` name, etc. If login is
> rejected as cross-site, a missing trusted origin is the usual cause. See
> [Configuration](/configuration) for the exact format.

```bash
# example, in packaging/docker/.env
BETTER_AUTH_TRUSTED_ORIGINS=http://192.168.1.248:4218,http://freya.local:4218
```

## Connecting other reader apps (OPDS)

Besides the web UI and the Flutter app, CB8 speaks **OPDS** — a standard
"catalog language" that lots of third-party reading apps understand. Point an
OPDS-capable app at your server and it can browse the library and stream books
without any CB8-specific setup.

The easy way to find the address: sign in, open **Settings**, and look for the
**Connect a reader app** card. It shows the catalog URL with a copy button —
it's simply your server address plus `/api/opds`, e.g.:

```
http://<host>:4218/api/opds
```

Paste that into your reader app's "add OPDS catalog" screen. Under the hood the
catalog lists every book with a link to its **Readium WebPub manifest**
(`/api/comics/<id>/manifest`), which is how modern reader apps stream comics,
EPUBs, and PDFs page by page. Guest access applies here the same way it does in
the browser — if guests can read your library, an OPDS app can too.

CB8 can do semantic ("search by meaning") search across the **text inside your
e-books**, on top of plain catalog search. This is **optional** and only works
when an embeddings service is configured:

- The API and worker read `EMBED_URL` and `EMBED_MODEL` (pointing at an
  OpenAI-compatible embeddings endpoint — the `cb8-embeddings` sidecar serves
  `BAAI/bge-large-en-v1.5` via Hugging Face TEI).
- The **worker** extracts and embeds your e-books' text into a `pgvector` index.
  Setting `SEARCH_BACKFILL_ON_START=1` (the default in the Compose worker) makes
  the worker enqueue a one-time index backfill on start so existing books get
  indexed.

Without these set, CB8 still runs and ordinary catalog search still works — you
just don't get semantic search inside book text. See [Configuration](/configuration)
for the variables.

## Comic HD upscaling (optional)

CB8 can serve GPU-upscaled comic pages (Real-ESRGAN, 2× sharper) for sharper
reading on large screens. This is **optional** and requires an upscale service:

- The API reads `UPSCALE_URL` (the `cb8-upscale` sidecar). For each page it POSTs
  the image and serves back the upscaled version.
- Upscaled pages are cached on disk under `CB8_UPSCALE_CACHE_DIR` (a persistent
  volume in production), because they're GPU-expensive to regenerate.

Without `UPSCALE_URL`, pages are served normally. Toggle HD in the reader when
the service is available.

## Metadata

On ingest, CB8 reads what it can from the files themselves: it extracts and
caches a **cover thumbnail**, counts pages, and infers **series** from the folder
structure (the top-level sub-folder under each library root). For EPUBs it reads
the OPF manifest to find the cover and page count.

Optionally, an admin can enrich an item from **external sources**. ComicVine is
one of the supported scrapers and requires an API key — set `COMICVINE_API_KEY`
and the admin search can pull candidate matches (title, year, summary, cover) to
apply. Without the key, external scraping for that source is skipped; ingest and
the rest of the app are unaffected.

## Backups and maintenance

Don't worry — backing up CB8 is simpler than it sounds, because there's really
only one thing to save. The most important thing to back up is the **database**
(Postgres). The catalog, covers, accounts, your reading progress, the e-book
search index, and the job to-do list all live there. (Your actual comic and book
files are separate, on disk, and CB8 never changes them — so they're their own
backup.)

- `CB8_DATA_DIR` (default `/var/lib/cb8`) holds only the **regenerable** image
  cache and uploaded archives. It is *not* durable state; you don't need to back
  it up to recover your catalog.
- Your **library files on disk are the source** and are never modified by CB8. If
  the catalog is ever lost or corrupted, you can rebuild it simply by re-adding
  the library paths and rescanning — the files reconstruct it.

### Backing up Postgres

**Docker Compose** — `pg_dump` (the standard Postgres backup tool) from inside
the database container:

```bash
docker compose exec -T cb8-postgres pg_dump -U cb8 -d cb8 > cb8-backup.sql
```

You should end up with a `cb8-backup.sql` file in your current folder; keep it
somewhere safe (ideally off the machine).

**Kubernetes** — exec into the Postgres Deployment in the `cb8` namespace:

```bash
kubectl -n cb8 exec deploy/cb8-postgres -- pg_dump -U cb8 -d cb8 > cb8-backup.sql
```

Restore by piping a dump back into `psql` against an empty `cb8` database. (Keep
`BETTER_AUTH_SECRET` stable across restores — rotating it invalidates existing
sessions and logs everyone out.)

### Rebuilding the catalog

Because the on-disk library is authoritative and CB8 never touches it, recovery
is low-stakes: point a fresh server at an empty database (the schema is created
on first connect), sign in as the new admin, re-add your library paths, and let
the worker rescan. Covers, page counts, and series grouping all regenerate.

## Resetting the admin password

While you're **signed in**, you can change the admin password from **Settings**
at any time. The initial generated password lives in the **Temporary password**
section there until you first change it.

For a **regular user**, resetting is easy: an admin opens **User management**
(user chip → User management) and sets a new password. The "Forgot password?"
link on the sign-in page says exactly this — the server doesn't send reset
emails, so recovery always goes through an admin.

For the **admin account itself**, recovery once that stored copy is cleared is
**non-trivial** — there's no one above the admin to ask. If you've lost the
admin password after changing it and can't sign in, the practical paths are:

1. Reset the admin row directly against the catalog database (Postgres), or
2. Recreate the database — CB8 then creates a fresh `admin` with a new generated
   password on next launch. Your **library files are untouched**, so you simply
   re-add the paths and rescan to rebuild the catalog (see above).

Because of this, **change the initial password to something you'll remember (or
store in a password manager) immediately after first sign-in.**
