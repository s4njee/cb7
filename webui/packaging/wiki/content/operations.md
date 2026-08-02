---
title: Operations
description: Day-two commands for logs, health checks, rescans, tuning, and maintenance
published: true
date: 2026-06-30T00:00:00.000Z
tags: cb8, operations, maintenance
editor: markdown
dateCreated: 2026-06-30T00:00:00.000Z
---

# Operations

This is the page for keeping CB8 running smoothly once it's set up. It shows you
how to check that everything is healthy, read the logs (the running diary the
software keeps), tell CB8 to look for new books and comics, and adjust a few
settings if things feel slow. You'll come here for routine check-ups, or when you
want to confirm that all the pieces are working.

No deep technical background is needed: copy a command, run it, and the page tells
you what a healthy result looks like. New terms are explained the first time they
appear, and you can always look words up in the [Glossary](/glossary).

## Health checks

These commands ask each part of CB8 "are you OK?" so you can confirm everything is
up before you go looking for problems.

### Docker Compose

```bash
cd packaging/docker
docker compose ps
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:${CB8_PUBLISH_PORT:-4218}/
```

What you should see:

- `cb8-postgres` is healthy. (Postgres is the database — CB8's filing cabinet. See [Glossary](/glossary).)
- `cb8` is running / healthy. (This is the part that serves the website.)
- `cb8-worker` is running. (The worker does background jobs like scanning your library.)
- HTTP returns `200`. (`200` is the web "all good" reply. Anything else, especially
  `000` or `5xx`, means the site isn't answering yet.)

If something says `unhealthy`, `restarting`, or `exited`, head to
[Troubleshooting](/troubleshooting).

### Kubernetes

```bash
kubectl -n cb8 get pods,svc,pvc
kubectl -n cb8 rollout status deploy/cb8
kubectl -n cb8 rollout status deploy/cb8-worker
```

## Logs

Logs are the running diary CB8 keeps as it works. When something goes wrong, the
explanation is almost always in here. The `-f` (follow) option keeps the diary
open and live so you watch new lines appear; press `Ctrl+C` to stop watching.

Docker:

```bash
docker compose logs -f cb8
docker compose logs -f cb8-worker
docker compose logs -f cb8-postgres
```

Kubernetes:

```bash
kubectl -n cb8 logs -f deploy/cb8
kubectl -n cb8 logs -f deploy/cb8-worker
kubectl -n cb8 logs -f deploy/cb8-postgres
```

Bare metal:

```bash
journalctl -u cb8-api -f
journalctl -u cb8-worker -f
```

Tune verbosity with:

```ini
CB8_LOG_LEVEL=debug
```

Return it to `info` after debugging; debug logs can be noisy during scans.

## Worker responsibilities

CB8 has two helpers that work as a team. The **API** is the part that serves the
website and takes requests. When there's a slow background job to do, it doesn't do
it on the spot — it writes the job onto a to-do list (stored in Postgres). The
**worker** is the helper that quietly works through that to-do list:

- library scans (finding and cataloguing your files — the "ingest" or "scan" step),
- search backfills (building the index that powers search),
- auto-rescan scheduling (checking your library for new files on a timer).

If the worker is down:

- The web UI can still load.
- Existing catalog browsing can still work.
- New library scans and background jobs do not progress.

Always run API and worker together in production.

## Rescanning libraries

A rescan tells CB8 to look through a folder again and pick up anything new. You add
or rescan library folders from the website while signed in as an admin — no
commands needed for this part. Rescanning is safe to do as often as you like: it
won't create duplicate entries or touch your actual files.

If a path was added but nothing appears:

1. Confirm the worker is running.
2. Confirm the path exists **inside** both API and worker containers/pods.
3. Confirm file extensions are supported.
4. Read worker logs.

Docker path check:

```bash
docker compose exec cb8-worker find /comics -maxdepth 2 -type f | head
```

Kubernetes path check:

```bash
kubectl -n cb8 exec deploy/cb8-worker -- \
  sh -c 'find /comics -maxdepth 2 -type f | head'
```

What you should see: a short list of your comic files. If you get nothing back,
the worker can't see your files where it expects them — check the folder path you
added in the website, and see "Scan sees zero files" in [Troubleshooting](/troubleshooting).

## Ingest tuning

"Ingest" is CB8's word for scanning and cataloguing your files. The settings below
control how hard it works during a scan. You only need to touch these if scans feel
too slow or are bogging down your server — otherwise the defaults are fine. These
are environment variables (named settings you set when starting CB8); see
[Configuration](/configuration) for where they live.

Important variables:

| Variable | Default | When to change |
| --- | --- | --- |
| `CB8_INGEST_CONCURRENCY` | `4` | Raise on a strong server; lower on a small NAS or slow disk. |
| `CB8_ARCHIVE_LIST_TIMEOUT_MS` | `60000` | Raise for huge / slow archives. |
| `CB8_ARCHIVE_EXTRACT_TIMEOUT_MS` | `30000` | Raise if individual page extraction times out. |
| `UV_THREADPOOL_SIZE` | `64` in Docker image | Usually leave alone; helps sharp/file I/O concurrency. |

Symptoms of too much concurrency:

- UI becomes sluggish during scan.
- Disk or NAS is saturated.
- Worker memory climbs.
- Archive tools time out under load.

Lower concurrency first.

## Cache maintenance

A cache is a stash of pre-computed files CB8 keeps so things load faster. The folder
named by `CB8_DATA_DIR` holds these stashes (mostly thumbnail and page images) plus
any archives people uploaded through the website. Most of it can be safely deleted and
will simply rebuild itself — the one thing to be careful of is uploaded files, covered
below.

- Image cache can be cleared when CB8 is stopped; pages regenerate.
- Uploaded archives should be kept if users uploaded files through the web UI and
  those uploads are the only copy.
- Upscale cache is regenerable but GPU-expensive; avoid deleting it unless you
  need the space or changed upscaling behavior.

Before deleting anything, confirm what your deployment stores there:

```bash
docker compose exec cb8 sh -c 'find "$CB8_DATA_DIR" -maxdepth 2 -type d -print'
```

## Backups

The one thing worth backing up regularly is the database, because it holds
everything CB8 has learned: your catalog, accounts, and reading progress. The
command below uses `pg_dump`, Postgres's built-in tool for saving the whole
database into a single file. Run it on a schedule and keep the files somewhere safe.

Docker:

```bash
docker compose exec -T cb8-postgres pg_dump -U cb8 -d cb8 > cb8-$(date +%F).sql
```

Kubernetes:

```bash
kubectl -n cb8 exec deploy/cb8-postgres -- \
  pg_dump -U cb8 -d cb8 > cb8-$(date +%F).sql
```

See [Backup and restore](/backup-restore) for restore steps.

## Useful one-liners

A few quick commands for everyday check-ups. Each one is safe to run and only
reports information.

Show container image versions:

```bash
docker compose images
kubectl -n cb8 get deploy cb8 cb8-worker -o wide
```

Check the API from inside the Docker network:

```bash
docker compose exec cb8 node -e "fetch('http://127.0.0.1:8008/').then(r=>console.log(r.status))"
```

Check Postgres readiness:

```bash
docker compose exec cb8-postgres pg_isready -U cb8 -d cb8
kubectl -n cb8 exec deploy/cb8-postgres -- pg_isready -U cb8 -d cb8
```

What you should see: a line ending in `accepting connections`. That means the
database is up and ready. Any other message means Postgres isn't ready yet.

## When to restart

Don't worry — restarting is routine and safe. Restart the API and worker after you
change a setting (an environment variable) or update CB8 to a new version:

```bash
docker compose up -d --force-recreate
```

or:

```bash
kubectl -n cb8 rollout restart deploy/cb8 deploy/cb8-worker
```

Restarting does not lose queued work; jobs live in Postgres.
