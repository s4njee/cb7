# CB8 Wiki (Wiki.js)

Self-hosted documentation for CB8, served by [Wiki.js](https://js.wiki). The
pages themselves live in [`content/`](content/) as Wiki.js-flavored markdown, so
they're version-controlled and reviewable; Wiki.js renders and serves them.

```
packaging/wiki/
  docker-compose.yaml   Wiki.js + its own Postgres (single-host)
  .env.example          compose config (DB password, published port)
  k8s/                  Wiki.js + Postgres manifests (kubectl apply -k)
  content/              the actual wiki pages (markdown + Wiki.js frontmatter)
    home.md             Overview (the landing page → /home)
    architecture.md
    installation/{docker,kubernetes,bare-metal}.md
    configuration.md
    usage.md
    formats.md
    glossary.md
    operations.md
    troubleshooting.md
    backup-restore.md
    upgrades.md
    reverse-proxy.md
    security.md
    gpu-services.md
```

> Wiki.js is **separate** from the CB8 server stack in `packaging/docker` and
> `packaging/k8s`. Run it wherever you want the docs to live; it has its own
> Postgres and never touches the CB8 database.

## 1. Run Wiki.js

### Docker Compose

```bash
cd packaging/wiki
cp .env.example .env          # set WIKI_DB_PASSWORD
docker compose up -d
```

Open `http://<host>:3000/` and complete the first-run wizard (create the wiki
admin account).

### Kubernetes

```bash
kubectl create namespace wiki
kubectl -n wiki create secret generic wiki-db --from-literal=password=<STRONG_PW>
kubectl apply -k packaging/wiki/k8s
kubectl -n wiki get pods,svc          # reach it on the Service's :4219
```

## 2. Load the CB8 pages

The pages in `content/` already carry the Wiki.js v2 frontmatter
(`title` / `description` / `published` / `editor: markdown` / dates), so Wiki.js
imports them as-is. Pick one of:

### Option A — Git sync (recommended)

Wiki.js's Git storage syncs a whole repository tree to wiki paths, so the content
should sit at the **root** of the synced repo/branch (otherwise pages land under
`packaging/wiki/content/...`). The simplest way is a dedicated wiki repo seeded
from `content/`:

```bash
cd packaging/wiki/content
git init -b main
git remote add origin <your-cb8-wiki-repo-url>
git add . && git commit -m "CB8 wiki"
git push -u origin main
```

Then in Wiki.js: **Administration → Storage → Git** — set the repository URL and
branch (`main`), add a deploy key/credentials, and **Sync**. The pages appear at
`/home`, `/installation/docker`, `/configuration`, `/troubleshooting`, etc.
Enable two-way sync if you want edits made in the UI pushed back to git.

### Option B — Manual

Create each page in **Wiki.js → New Page** (Markdown editor) using the matching
path (e.g. `installation/docker`) and paste the body of the corresponding file
from `content/`. Fine for a one-time load of a handful of pages.

## 3. Set the landing page

In **Administration → General**, set the home path to `/home` so the Overview
page is the wiki's front page. The in-page links (`/installation/docker`,
`/configuration`, `/usage`, `/operations`, `/troubleshooting`, …) resolve once
the pages are imported.

## Editing the docs

Edit the markdown in `content/` and re-sync (Option A), or edit in the Wiki.js UI
and let two-way git sync push changes back. Keep the frontmatter block intact —
Wiki.js manages those fields.
