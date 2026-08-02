# Deploying CB8 to the homelab cluster (freya)

This is the operational runbook for the single production deployment: the `cb8`
namespace on the **`freya` k3s cluster** (control-plane `freya` + worker `mars`),
exposed on host port **4218** (→ container `8008`).

Deployment is **GitOps via Argo CD** — there is no manual `kubectl apply` in the
normal flow and no Docker Compose on the host. Argo watches this repo and syncs
the cluster to match. For the general, multi-target story (desktop, standalone
Node, generic Docker, other clusters) see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

> **Superseded:** earlier versions of this file described a `docker compose`
> deployment on `~/cb8-compose`. That path is retired — freya runs k3s + Argo CD.

## How the deployment is wired

Argo CD (in the cluster's `argocd` namespace) runs an `Application`
([`packaging/argocd/cb8.yaml`](packaging/argocd/cb8.yaml)) that watches
**`webui/packaging/k8s`** on the **`main`** branch and keeps the `cb8`
namespace in sync — `automated` sync with `selfHeal` and `prune`. So a `git push`
that changes those manifests rolls out on its own; you do not run `kubectl apply`
for a normal deploy.

This is a **monorepo**: `s4njee/CB8` holds the Flutter app at the root and the
server under `webui/`, so Argo's `path` is `webui/packaging/k8s`. The shell
commands below are written to run from the **`webui/` directory** of a clone
(where `package.json` and `packaging/` live).

The stack mirrors the compose topology as three Deployments — `cb8-postgres`,
`cb8` (API), `cb8-worker` — plus the embeddings and upscale services.

| Thing | Where it lives |
| --- | --- |
| Manifests + pinned image tag | [`packaging/k8s/`](packaging/k8s) (`kustomization.yaml` → `images:` → `newTag`) |
| Container image | `registry.s8njee.com/cb8:<tag>`, built from [`packaging/docker/Dockerfile`](packaging/docker/Dockerfile) |
| Postgres data — catalog, covers, users/sessions, search vectors, job queue (**the durable state**) | the `cb8-postgres` PVC |
| Image cache + uploaded archives (regenerable) | the `web-uploads` volume / `/mnt/raid6` hostPaths → container `/var/lib/cb8` |
| Comics / ebooks libraries (read-only source) | `/mnt/raid6/comics`, `/mnt/raid6/ebooks` hostPaths |

**Secrets are NOT managed by Argo** — they must already exist in the `cb8`
namespace: `cb8-db` (Postgres `url` + `password`), `cb8-secrets`
(`better-auth-secret`, which is what keeps existing logins valid across a
redeploy), and `registry-s8njee-pull` (pull creds for the private registry). A
redeploy never touches these or the Postgres PVC, so logins and the catalog
survive.

## Deploy procedure

The image is **not** built by CI (the only GitHub workflow is the docs site), so
a frontend/backend change reaches freya in two moves: **build + push a new
image**, then **bump the pinned tag and push to `main`**. Argo does the rest.

### 1. Build and push the image

Run from a clone of this repo. Pick a unique tag — the repo has used build
numbers (`1857253`) and timestamps (`20260701-010043`); a timestamp is easiest:

**freya's node is `amd64`** (and the cb8 pods are pinned to it via
`nodeSelector`), so the image MUST be built for `linux/amd64`. On an Apple
Silicon / arm64 workstation you must pass `--platform linux/amd64` — a native
build produces an arm64 image that the node can't pull (`ImagePullBackOff`, "no
matching manifest for linux/amd64").

```sh
cd webui                     # the Docker build context is the server dir
TAG=$(date +%Y%m%d-%H%M%S)
docker build --platform linux/amd64 \
  -f packaging/docker/Dockerfile -t registry.s8njee.com/cb8:"$TAG" .
docker push registry.s8njee.com/cb8:"$TAG"
```

The renderer and both server bundles (`dist/standalone.mjs` + `dist/worker.mjs`)
are built inside the Dockerfile (`pnpm build:standalone` runs `build:renderer`
via its prebuild hook). Native modules (sharp, @napi-rs/canvas) compile in the
builder stage, so this takes a few minutes.

### 2. Pin the new tag and push

```sh
# edit packaging/k8s/kustomization.yaml → images: → newTag: "<TAG>"
git commit -am "deploy: cb8 <TAG>"
git push origin main
```

Argo picks up the commit within its sync interval (or immediately if you refresh
it) and rolls the `cb8` + `cb8-worker` Deployments onto the new image.

### 3. Verify

```sh
kubectl --context freya -n cb8 rollout status deploy/cb8
kubectl --context freya -n cb8 get pods -l app=cb8 \
  -o jsonpath='{.items[*].spec.containers[*].image}{"\n"}'
# Argo's view of the synced revision + health:
kubectl --context freya -n argocd get application cb8 \
  -o jsonpath='{.status.sync.status} {.status.health.status} {.status.sync.revision}{"\n"}'
```

Expect the pods to report `registry.s8njee.com/cb8:<TAG>` and Argo to read
`Synced Healthy <commit>`. From the LAN the app is at `http://freya.local:4218/`.

Argo polls the repo on an interval; to force an immediate re-check instead of
waiting, refresh the Application (the `argocd` CLI's `argocd app get cb8
--refresh`, the web UI's Refresh button, or annotating it):

```sh
kubectl --context freya -n argocd annotate application cb8 \
  argocd.argoproj.io/refresh=normal --overwrite
```

## Repointing Argo at a different branch

Argo's tracked branch lives in the `Application`'s `spec.source.targetRevision`
(currently `main`). Changing it is a one-time cluster operation — edit
[`packaging/argocd/cb8.yaml`](packaging/argocd/cb8.yaml) and re-apply the
Application itself (Argo does not manage its own definition):

```sh
kubectl --context freya apply -f packaging/argocd/cb8.yaml
```

## Rollback

Because the deployed version is just the pinned tag in Git, a rollback is a Git
operation — revert the tag bump and push; Argo syncs back:

```sh
git revert <the deploy commit> && git push origin main
```

Or roll back live and let `selfHeal` be overridden temporarily via the Argo UI /
`argocd app rollback cb8`. The registry keeps prior tags, so the old image is
still pullable. Durable data lives in Postgres and is never modified by an image
redeploy, so a rollback is image-only. Snapshot the catalog before anything risky:

```sh
kubectl --context freya -n cb8 exec deploy/cb8-postgres -- \
  pg_dump -U cb8 -d cb8 > cb8-$(date +%F).sql
```

The on-disk library files under `/mnt/raid6` are the original source and are
never written to, so the catalog can also be rebuilt by re-adding the library
paths and rescanning.

## Notes / gotchas

- **First-run admin password** is only printed on a fresh Postgres volume. This
  cluster is already provisioned, so a redeploy will not reprint it. Recover via
  **Settings → Temporary password** while signed in (shown until first changed).
- **Trusted origins.** `BETTER_AUTH_TRUSTED_ORIGINS` (in `cb8-secrets` / the API
  env) must list every hostname/port the app is reached by (e.g.
  `http://freya.local:4218`) or logins from those origins are rejected as
  cross-site.
- **`newTag` must point at a tag you actually pushed.** Argo will happily sync a
  manifest referencing a missing image and the pods will land in `ImagePullBackOff`.
- **The netcup overlay is decommissioned.** `packaging/k8s/overlays/netcup`
  targeted a separate cloud cluster (`books.sanjee.dev`); that cluster's `cb8`
  namespace has been deleted and nothing deploys from the overlay anymore. The
  files stay in-repo as a reference for standing up a second, ingress-fronted
  target. It was never Argo-managed — it was applied manually, and because the
  overlay references its base via `../../`, `kubectl kustomize` needs the load
  restrictor relaxed:

  ```sh
  kubectl kustomize --load-restrictor LoadRestrictionsNone \
    webui/packaging/k8s/overlays/netcup | kubectl --context <ctx> apply -f -
  ```

  Argo's `path` is the base `packaging/k8s`; the overlay's own pinned tag is
  frozen at its last deploy.
