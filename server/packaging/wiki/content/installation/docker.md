---
title: Install with Docker
description: Run CB8 with Docker Compose — the recommended self-hosted setup. Three containers, one command.
published: true
date: 2026-06-30T00:00:00.000Z
tags: cb8, install
editor: markdown
dateCreated: 2026-06-30T00:00:00.000Z
---

# Install with Docker

This is the easiest way to run CB8, and the one we recommend for most people. You
run a few commands and CB8 sets itself up: the web app, a background helper, and
its database all start together. You do not need to be a developer to follow this
page — just comfortable copying commands into a terminal.

A quick word on the jargon: a **container** is a self-contained mini-environment
that bundles a program with everything it needs to run, and **Docker Compose**
starts a group of containers together with one command. CB8's setup uses three
such containers. (See the [Glossary](/glossary) for these and other terms.)

If you run Kubernetes, see [/installation/kubernetes](/installation/kubernetes)
instead — but that path is for advanced users. To run on a plain server without
containers, see [/installation/bare-metal](/installation/bare-metal). Most people
should stay here.

## Before you start

You will need:

- A machine (your own computer, a home server, or a NAS) with **Docker** and
  **Docker Compose** already installed — see Docker's own install guide if you
  do not have them yet.
- To know **where your comics and e-books live** on that machine — the folder
  paths. CB8 reads from those folders; it never changes or deletes your files.

## Prerequisites

- **Docker** (Engine 24+).
- **Docker Compose** (the `docker compose` v2 plugin).

That's it. The database (**Postgres**, the program CB8 stores its catalog in) runs
as a container in the stack — you do **not** install it separately.

## What the stack runs

CB8 is made of three pieces that run side by side (each in its own container). You
do not have to manage them individually — Compose handles all three together — but
here is what they are, so the names in later steps make sense. The compose file
lives in `packaging/docker/`:

| Service | Image | Role |
| --- | --- | --- |
| `cb8-postgres` | `pgvector/pgvector:pg18` | Postgres 18 + pgvector — the source of truth (catalog, covers, users/sessions, ebook search vectors, job queue). |
| `cb8` | built from `packaging/docker/Dockerfile` (or `CB8_IMAGE`) | Fastify API + React UI (`dist/standalone.mjs`). Listens on container port **8008**, published on the host as **4218** by default. |
| `cb8-worker` | same image as `cb8` | Background worker (`dist/worker.mjs`) — drains the job queues (library scans, ebook search backfill) and runs the auto-rescan scheduler. |

The server **requires** Postgres — it reads `DATABASE_URL` and refuses to start
without it. The database **schema is created automatically** on first connect
(including the `vector` extension), so you point it at an empty database and CB8
initializes everything.

## Steps

### 1. Get the files

Clone the repository (or copy the `packaging/docker/` directory onto the host)
and change into the compose directory:

```bash
cd packaging/docker
cp .env.example .env
```

> Note: the compose file's `build:` block uses `context: ../..`, so it must sit
> at `<repo>/packaging/docker/` for a `docker compose build` to work. If you only
> copy the files out, set `CB8_IMAGE` to a prebuilt image instead of building.

### 2. Configure `.env`

The `cp` command above copied the example settings file `.env.example` to a new
file called `.env`. That `.env` file is where you put your own settings — it is
just a plain text file of `NAME=value` lines (each line is an **environment
variable**, a named setting the app reads on startup; see the
[Glossary](/glossary)).

Open `.env` in any text editor and set, at minimum, these three values. The rest
have sensible defaults — see [/configuration](/configuration) for the full list.

```ini
# Postgres password for the `cb8` role. Used by BOTH the postgres container and
# the DATABASE_URL the app/worker connect with, so they always match.
CB8_DB_PASSWORD=<a-strong-password>

# Signs better-auth sessions. Generate ONCE and keep it stable — rotating it
# logs everyone out.
BETTER_AUTH_SECRET=<paste output of: openssl rand -hex 32>

# Comma-separated list of EVERY origin the app is reached by, or logins are
# rejected as cross-site. Include each host:port you browse to.
BETTER_AUTH_TRUSTED_ORIGINS=http://192.168.1.10:4218,http://myhost.local:4218
```

In plain terms:

- **`CB8_DB_PASSWORD`** — make up a strong password for the database. You will not
  type it again day to day; CB8 uses it internally. Any long random string is
  fine.
- **`BETTER_AUTH_SECRET`** — a long random key that keeps you logged in securely.
  Generate a good one with the command below and paste the result in. Set it once
  and leave it alone — changing it later logs everyone out.
- **`BETTER_AUTH_TRUSTED_ORIGINS`** — the web address(es) you will use to open CB8
  in your browser, separated by commas. For example, if you'll reach it at
  `http://192.168.1.10:4218`, put that. List every address you use (an IP, a
  hostname, a `.local` name); if a login comes from an address that isn't listed,
  it's rejected for safety. The `4218` is the **port** — the door number the app
  answers on (see [Glossary](/glossary)).

Generate the auth secret with this command and paste its output as the value of
`BETTER_AUTH_SECRET`:

```bash
openssl rand -hex 32
```

#### Storage paths (host side)

These tell CB8 which folders on your machine to use. To **mount** a folder means
to make it visible inside a container (see [Glossary](/glossary)). Point the
library paths at where your comics and e-books actually live — these are mounted
**read-only**, so CB8 can read your files but never change or delete them.
`CB8_DATA_PATH` is a working folder CB8 owns, for thumbnails and uploads (it can
be rebuilt if lost).

```ini
# Image cache + uploaded archives (shared by the API and worker).
CB8_DATA_PATH=/srv/cb8/data

# Your libraries (mounted read-only as /comics and /ebooks in the containers).
CB8_COMICS_PATH=/mnt/raid6/comics
CB8_EBOOKS_PATH=/mnt/raid6/ebooks
```

#### Networking

This sets the **port** — the number you'll put after the address in your browser,
like `http://your-machine:4218`. Inside its container the app always uses `8008`;
this line picks the number you'll actually type:

```ini
# Host port for the web UI (container always listens on 8008).
CB8_PUBLISH_PORT=4218
```

For a home setup, keep this on your home/trusted network rather than exposing it
to the open internet.

#### Image: build vs. pull

An **image** is the prepackaged template a container is started from (see
[Glossary](/glossary)). By default the stack builds this image locally from the
source code and tags it `cb8:latest`. If instead you have a ready-made image to
download, set `CB8_IMAGE` in `.env`:

```ini
# CB8_IMAGE=registry.example.com/cb8:1857253
```

### 3. Bring up the stack

Build and start everything:

```bash
docker compose up -d --build
```

Or, if you set `CB8_IMAGE` to a prebuilt tag, just:

```bash
docker compose up -d
```

The very first start can take a few minutes while it builds. That's normal — let
it finish. (The `-d` runs everything quietly in the background, so getting your
prompt back does not mean it's ready yet.)

## Verify

Give it a minute after the previous step, then check that all three pieces are up
and the database is healthy:

```bash
docker compose ps
```

**What you should see:** three services listed — `cb8-postgres` showing `healthy`,
and `cb8` and `cb8-worker` showing `running`. If `cb8-postgres` still says
`starting`, wait a few more seconds and run the command again.

Then confirm the web app is actually answering:

```bash
curl -fsS http://127.0.0.1:4218/
```

**What you should see:** a page of HTML printed to the terminal (not an error).
That means the web UI is being served and you can now open it in your browser at
the address you set in `BETTER_AUTH_TRUSTED_ORIGINS`. If you instead get a
"connection refused" error, the app probably isn't finished starting — wait a bit
and try again.

### First-run admin password

The first time CB8 starts with an empty database, it creates an `admin` account
for you and prints a randomly generated password into its logs. Here's how to read
that password back out:

```bash
docker compose logs cb8 | grep -i password
```

**What you should see:** a line containing the generated admin password. Copy it,
then open CB8 in your browser and sign in with the username `admin` and that
password. (The password is shown only on that first start against an empty
database, so save it somewhere safe.)

## First steps after install

Once you're signed in as admin, add `/comics` and `/ebooks` as library paths from
the web UI to trigger the first scan. See [/usage](/usage) for the full walkthrough.

## Backups

The **durable data lives in Postgres** (catalog, covers, users/sessions, ebook
search vectors, job queue). `CB8_DATA_DIR` is just regenerable cache plus uploaded
archives, and your library files under `/comics` / `/ebooks` are never written to.
So back up the database with `pg_dump`, not the data directory:

```bash
docker exec cb8-postgres pg_dump -U cb8 -d cb8 > cb8-$(date +%F).sql
```

Restore into a fresh stack with:

```bash
docker exec -i cb8-postgres psql -U cb8 -d cb8 < cb8-2026-06-30.sql
```

## Updating

Rebuild (or re-pull) the image, then recreate the containers. The Postgres volume,
the data directory, and your `.env` (including the auth secret and DB password)
are untouched, so logins and the catalog survive the update:

```bash
# rebuild from source...
docker compose build
# ...or pull a new CB8_IMAGE tag:
docker compose pull

docker compose up -d --force-recreate
```

`--force-recreate` guarantees the containers restart onto the new image even when
the tag name is unchanged.
