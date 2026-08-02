---
title: Backup and Restore
description: Back up and restore CB8's Postgres catalog, auth state, progress, and job queue
published: true
date: 2026-06-30T00:00:00.000Z
tags: cb8, backup, restore, operations
editor: markdown
dateCreated: 2026-06-30T00:00:00.000Z
---

# Backup and Restore

This page shows you how to make a safety copy of CB8 and how to bring it back if
something goes wrong. Good news first: your actual comics and books are never at risk
from CB8 — it only reads those files, never changes them, so they're already as safe
as your normal file backups make them. What's worth protecting is everything CB8 has
*remembered*: your catalog, accounts, and reading progress.

All of that lives in one place — the **database**, run by Postgres (CB8's filing
cabinet; see [Glossary](/glossary)). So a CB8 backup is really just a copy of that
database. The folder named by `CB8_DATA_DIR` holds rebuildable extras (cached images
and any uploaded files); it mostly takes care of itself.

You'll come here to set up regular backups, and — calmly — when you need to restore
one. Follow the steps in order and nothing is lost.

## What to back up

Here's everything CB8 touches and whether it's worth backing up. Only the first few
rows really matter.

| Data | Location | Back up? | Notes |
| --- | --- | --- | --- |
| Catalog, covers, users, sessions, progress, vectors, jobs | Postgres | **Yes** | This is CB8's durable state. |
| Auth signing secret | `.env` / Kubernetes Secret / service unit | **Yes** | Keep `BETTER_AUTH_SECRET` stable or everyone is logged out. |
| Image cache | `<CB8_DATA_DIR>/image-cache` | Usually no | Regenerates on demand. |
| Upscale cache | `CB8_UPSCALE_CACHE_DIR` | Optional | Regenerates, but GPU-expensive. |
| Uploaded archives | `<CB8_DATA_DIR>/web-uploads` | Yes if you use uploads | These are source files added through the web UI. |
| Library files | Your `/comics`, `/ebooks`, NFS, NAS, etc. | Already your source | Back them up with your normal storage plan. |

## Docker Compose backup

The command below makes the backup. It uses `pg_dump`, Postgres's built-in tool for
copying an entire database into a single file. The `> cb8-...sql` part saves that
copy to a file named with today's date, in whatever folder you run the command from.
Keep these files somewhere safe (ideally a different machine).

From `packaging/docker`:

```bash
docker compose exec -T cb8-postgres pg_dump -U cb8 -d cb8 > cb8-$(date +%F).sql
```

What you should see: the command finishes with no error and a file like
`cb8-2026-06-30.sql` appears. If that file has a sensible size (not zero bytes), your
backup worked.

If you run the command from elsewhere, pass the compose file or use the container
name directly:

```bash
docker exec cb8-postgres pg_dump -U cb8 -d cb8 > cb8-$(date +%F).sql
```

Also keep a copy of your `.env` file (the file that holds CB8's settings),
especially these values:

- `CB8_DB_PASSWORD` — the database password.
- `BETTER_AUTH_SECRET` — the signing key for logins. Keep this the same after a
  restore or everyone gets logged out.
- `BETTER_AUTH_TRUSTED_ORIGINS` — the web addresses allowed for sign-in.
- your library folder paths.

Keep `.env` private — it contains passwords — and never upload it anywhere public.

## Docker Compose restore

Restoring means loading a backup file back into a clean, empty database. Take your
time — as long as you start from an empty database and keep your `BETTER_AUTH_SECRET`
the same, nothing is lost. The plan is:

1. Stop CB8.
2. Create a fresh, empty database (a new "volume" — a named storage area; see
   [Glossary](/glossary)).
3. Start only the database.
4. Load your backup file into it.
5. Start the website and worker.

Example (the third command loads your backup — change the filename to match yours):

```bash
docker compose down
docker volume rm cb8-postgres-data
docker compose up -d cb8-postgres
docker compose exec -T cb8-postgres psql -U cb8 -d cb8 < cb8-2026-06-30.sql
docker compose up -d
```

If your compose project name changes, the volume name may be prefixed. Check with:

```bash
docker volume ls | grep cb8
```

Keep the same `BETTER_AUTH_SECRET` after a restore so people who were signed in
stay signed in.

## Kubernetes backup

These steps are only for Kubernetes deployments; the idea is identical to the Docker
backup above. Besides the database, save the relevant Kubernetes "secrets" — its
secure store for passwords and keys (see [Glossary](/glossary)).

```bash
kubectl -n cb8 exec deploy/cb8-postgres -- \
  pg_dump -U cb8 -d cb8 > cb8-$(date +%F).sql
```

Back up the relevant Secrets too:

```bash
kubectl -n cb8 get secret cb8-db -o yaml > cb8-db-secret.yaml
kubectl -n cb8 get secret cb8-secrets -o yaml > cb8-secrets-secret.yaml
```

Store secret exports somewhere private.

## Kubernetes restore

Same idea as the Docker restore: turn CB8 off, load the backup into an empty
database, then turn it back on. Here "turning off" is done by scaling to `0`
(running zero copies) and "turning on" by scaling back to `1`.

For an empty restored database:

```bash
kubectl -n cb8 scale deploy/cb8 --replicas=0
kubectl -n cb8 scale deploy/cb8-worker --replicas=0
kubectl -n cb8 exec -i deploy/cb8-postgres -- \
  psql -U cb8 -d cb8 < cb8-2026-06-30.sql
kubectl -n cb8 scale deploy/cb8 --replicas=1
kubectl -n cb8 scale deploy/cb8-worker --replicas=1
```

If the Postgres PVC was lost, recreate it from your manifests first, then restore
into the new empty database.

## Bare-metal backup

This is for installs that run directly on the machine, without containers. It's the
same `pg_dump` tool, just run on the host.

```bash
pg_dump "$DATABASE_URL" > cb8-$(date +%F).sql
```

or:

```bash
pg_dump -U cb8 -d cb8 > cb8-$(date +%F).sql
```

Back up your systemd unit or environment file containing `BETTER_AUTH_SECRET`.

## Rebuild instead of restore

No database backup, but you still have your comics and books? You're not stuck. CB8
can build a fresh catalog straight from your files. This recovers everything it can
work out from the files themselves, but not personal data like reading progress — see
the note below.

To rebuild:

1. Start with an empty database.
2. Sign in with the freshly generated admin password.
3. Re-add `/comics` and `/ebooks`.
4. Let the worker rescan.

This restores covers, page counts, series grouping, and metadata derived from
files. It does **not** restore users, reading progress, favorites, tags,
collections, or manual metadata edits. Use a database restore when you need those.

## Test your backup

A backup you've never restored is really just a hope. Once — on a spare or throwaway
copy, never your live system — walk through an actual restore so you know it works
and you've practiced the steps:

1. Start a fresh, empty database.
2. Load your backup file into it.
3. Start the website and worker with the same `BETTER_AUTH_SECRET`.
4. Confirm you can sign in.
5. Confirm your library, covers, and Continue Reading all show up.
6. Open one comic or book.

A backup is only useful after a restore has been tested. Future-you will be
grateful in the quietest possible way.
