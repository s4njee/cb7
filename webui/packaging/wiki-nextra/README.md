# CB8 Docs (Nextra)

A static documentation site for CB8, built with [Nextra](https://nextra.site)
(the same framework Kavita's wiki uses). It renders the **same Markdown** as the
Wiki.js setup — the pages under `pages/` are generated from
[`../wiki/content`](../wiki/content) — but ships as a fast static site served by
nginx, with no database.

Deployed two ways from one source: on freya at **http://192.168.1.156:4220/**
(k8s namespace `wiki-nextra`), and on **https://s4njee.github.io/CB8/** via
GitHub Pages (see [Deploy to GitHub Pages](#deploy-to-github-pages)).

```
packaging/wiki-nextra/
  package.json          Next + Nextra deps
  next.config.mjs       Nextra wrapper, output: 'export' (static)
  theme.config.jsx      docs theme (logo, repo link, dark mode)
  pages/                MDX pages + _meta.js nav (converted from ../wiki/content)
    index.mdx           home/Overview
    _meta.js            top-level sidebar order/labels
    installation/       docker / kubernetes / bare-metal + _meta.js
    *.mdx
  Dockerfile            nginx:alpine serving the static export
  nginx.conf            clean-URL routing for the export
  k8s/                  Deployment + LoadBalancer Service (kubectl apply -k)
```

## Build the static site

This folder lives inside the `webui` pnpm workspace, so install with
`--ignore-workspace`:

```bash
cd packaging/wiki-nextra
pnpm install --ignore-workspace
pnpm build                 # -> ./out (static HTML/CSS/JS)
```

Preview locally: `pnpm dev` (http://localhost:3000), or serve the export with
`python3 -m http.server -d out`.

## Build & push the image (multi-arch)

The freya cluster is mixed amd64/arm64, so build a manifest list:

```bash
TAG=$(date +%Y%m%d%H%M)
docker buildx build --platform linux/amd64,linux/arm64 \
  -t registry.s8njee.com/cb8-wiki-nextra:$TAG --push .
```

## Deploy to Kubernetes

```bash
# one-time: pull secret in this namespace (copied from cb8)
kubectl create namespace wiki-nextra
kubectl get secret registry-s8njee-pull -n cb8 -o yaml \
  | sed 's/namespace: cb8/namespace: wiki-nextra/' \
  | kubectl apply -n wiki-nextra -f -

# pin the new tag, then apply
(cd k8s && kustomize edit set image registry.s8njee.com/cb8-wiki-nextra=registry.s8njee.com/cb8-wiki-nextra:$TAG)
kubectl apply -k k8s
kubectl -n wiki-nextra rollout status deploy/cb8-wiki-nextra
```

The Service is a LoadBalancer on port **4220** (4218 = cb8, 4219 = Wiki.js).

## Deploy to GitHub Pages

The same source also publishes to GitHub Pages at **https://s4njee.github.io/CB8/**
via [`.github/workflows/wiki-pages.yml`](../../../.github/workflows/wiki-pages.yml).
The workflow runs on pushes to `main` that touch this folder (or the workflow
itself), and on manual dispatch. No setup is needed beyond Pages being enabled
with the **GitHub Actions** source.

Project Pages live under `/<repo>`, so the workflow builds with
`PAGES_BASE_PATH=/CB8` to prefix every asset and link. The nginx/k8s build sets
no such variable and serves at the domain root — one source, both targets (see
[`next.config.mjs`](next.config.mjs)). To preview the Pages build locally:

```bash
PAGES_BASE_PATH=/CB8 pnpm build && python3 -m http.server -d out 8000
# then open http://localhost:8000/CB8/
```

## Updating the docs

Edit the Markdown in [`../wiki/content`](../wiki/content), re-run the converter
(see the project history / `pages/` are a 1:1 copy minus the Wiki.js frontmatter,
with `home.md` → `index.mdx` and `/home` links → `/`), then rebuild the static
site, push a new image tag, and re-apply. Because the site is baked into the
image, a redeploy is image-only — no data to migrate.
