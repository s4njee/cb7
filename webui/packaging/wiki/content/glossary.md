---
title: Glossary
description: Plain-language definitions of the technical terms used throughout this wiki
published: true
date: 2026-06-30T00:00:00.000Z
tags: cb8, glossary, reference
editor: markdown
dateCreated: 2026-06-30T00:00:00.000Z
---

# Glossary

New to self-hosting? This page explains, in plain language, the words that show up
across the rest of the wiki. You don't need to memorize any of it — skim it once,
then come back whenever a term trips you up. Terms are grouped by topic.

## The big picture

- **Self-hosting** — running an app on a computer *you* control (a spare PC, a
  home server, a NAS, or a rented machine) instead of using someone else's cloud
  service. You own the data and decide who can reach it.
- **CB8 server** — the program that reads your comic/e-book files, builds a
  catalog, and serves it to apps and browsers. This wiki is about running it.
- **Client** — anything you *read with*: the CB8 phone/tablet/desktop app, or just
  a web browser. Clients talk to the server.
- **Catalog** — CB8's index of your library (titles, covers, series, your place in
  each book). It's built *from* your files; your actual files are never changed.

## Running software

- **Terminal / command line** — a text window where you type commands instead of
  clicking buttons. On macOS it's "Terminal"; on Windows, "PowerShell" or "Windows
  Terminal." The grey code boxes in this wiki are commands you paste there.
- **Command** — a single instruction you type into the terminal and run by pressing
  Enter.
- **Node.js** — the runtime the CB8 server is built on. You only deal with it
  directly on the [bare-metal](/installation/bare-metal) path; Docker bundles it
  for you.

## Docker (the recommended path)

- **Docker** — software that runs apps in self-contained boxes called *containers*,
  so you don't have to install the app's dependencies by hand. The easiest way to
  run CB8.
- **Container** — one running instance of an app in its own isolated box. CB8 runs
  as a few containers (the server, a helper "worker," and the database).
- **Image** — the read-only template a container is started from, like an installer
  snapshot. "Pull an image" means download that template.
- **Docker Compose** — a tool that starts several containers together from one
  settings file (`docker-compose.yaml`). You run the whole CB8 stack with one
  command.
- **Volume** — storage that lives *outside* a container so your data survives when
  the container is replaced or upgraded. CB8's database lives in a volume.
- **Publish a port** — make a container reachable from your computer/network on a
  chosen port (see *Port*). CB8 publishes its web page on port `4218` by default.

## Settings and secrets

- **Environment variable** — a named setting passed to a program when it starts
  (e.g. `CB8_PORT=8008`). CB8 is configured almost entirely through these. See
  [Configuration](/configuration).
- **`.env` file** — a plain text file holding your environment variables for Docker
  Compose, one per line. You copy `.env.example` to `.env` and fill it in.
- **Secret** — a sensitive value like a password or signing key. Keep these private
  and out of public code. In Kubernetes, "Secret" is also the name of the object
  that stores them.
- **Port** — a numbered "door" on a computer that a program listens on. CB8 listens
  on `8008` inside its container and is published on `4218` to your network.

## The database

- **Database** — where CB8 stores everything durable: the catalog, user accounts,
  reading progress, and search data. CB8 uses **PostgreSQL**.
- **PostgreSQL ("Postgres")** — a popular, reliable open-source database. CB8
  requires it; the Docker and Kubernetes setups run it for you.
- **pgvector** — an add-on to Postgres that stores "embeddings" (see below), used
  by the optional e-book semantic search. The recommended Postgres image includes
  it.
- **`pg_dump` / backup** — `pg_dump` is the command that exports the whole database
  to a file you can save. That file is your backup. See
  [Backup and restore](/backup-restore).

## How CB8 is built internally

- **API** — the main CB8 program: it serves the web page and answers the apps.
- **Worker** — a companion program that does the slow background jobs (scanning your
  library, building search). The API hands jobs to the worker through the database.
  Both must be running. See [Architecture](/architecture).
- **Ingest / scan** — the process of looking through your library folders and adding
  what it finds to the catalog (covers, page counts, series).
- **Backfill** — a catch-up job that processes existing items, e.g. building search
  data for books that were added before search was turned on.

## Reaching it from outside / over HTTPS

- **Origin** — the exact combination of address scheme, hostname, and port a page
  is opened from, e.g. `https://reader.example.com`. CB8 must be told to *trust*
  each origin people sign in from (`BETTER_AUTH_TRUSTED_ORIGINS`), or logins fail.
- **HTTPS / TLS** — the encrypted, padlock version of web traffic. Required if you
  reach CB8 over the internet rather than a trusted home network.
- **Certificate** — the file that proves a site's identity and enables HTTPS. Tools
  like Caddy obtain and renew these for you.
- **Reverse proxy** — a front-door program (Caddy, Nginx, Traefik) that sits in
  front of CB8 to add HTTPS and a nice hostname. Optional. See
  [Reverse proxy and HTTPS](/reverse-proxy).

## Kubernetes (advanced)

- **Kubernetes ("k8s")** — software for running containers across one or more
  machines (a "cluster"), with automatic restarts and scaling. Powerful but
  advanced — most home users should use [Docker](/installation/docker) instead.
- **Pod** — Kubernetes' unit of running work; usually one container. CB8 runs as a
  few pods (server, worker, database).
- **Deployment** — a Kubernetes object that keeps a pod running and replaces it on
  updates.
- **PVC (Persistent Volume Claim)** — Kubernetes' version of a volume: durable
  storage requested by a pod (CB8's database uses one).
- **NFS** — network file sharing, one common way to mount your comic/e-book folders
  into the cluster.
- **Namespace** — a labeled section of a cluster that groups related objects (CB8
  lives in the `cb8` namespace).
- **kustomize / `kubectl apply -k`** — the tool/command that applies the bundle of
  CB8's Kubernetes settings files at once.

## Optional GPU features

- **GPU** — a graphics card. Only the two optional services below need one; the core
  reader does not. See [Optional GPU services](/gpu-services).
- **Embeddings** — numeric "fingerprints" of text that let the computer find
  passages by meaning, not just exact words. They power e-book *semantic search*.
- **Semantic search** — search that understands meaning, so "space wizard" can find
  a book about a galactic sorcerer even without those exact words.
- **Upscaling (Real-ESRGAN)** — using a GPU to sharpen/enlarge comic pages into a
  higher-quality "HD" version, which CB8 then caches.

## File formats (quick reference)

- **CBZ / CBR** — comic archives (a folder of page images zipped up). CBZ is a ZIP;
  CBR is a RAR. Both are read by the server. See [Format support](/formats).
- **EPUB / PDF / MOBI** — e-book/document formats. EPUB and PDF read everywhere;
  MOBI is cataloged but best converted to EPUB/PDF for reading.
- **7-Zip / unrar** — the small helper tools the server uses to open CBZ/CBR
  archives. Docker installs them for you.
