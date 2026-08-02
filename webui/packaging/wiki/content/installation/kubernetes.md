---
title: Install on Kubernetes
description: Deploy CB8 to a Kubernetes cluster with the bundled kustomize manifests.
published: true
date: 2026-06-30T00:00:00.000Z
tags: cb8, install
editor: markdown
dateCreated: 2026-06-30T00:00:00.000Z
---

# Install on Kubernetes

> **This is an advanced path.** It assumes you already run a Kubernetes cluster
> and are comfortable with `kubectl`, secrets, and editing manifests. If that
> isn't you, you don't need any of this — follow [Install with Docker](/installation/docker)
> instead. Docker is the easy, recommended way to run CB8 on a single machine and
> does everything most people want.

Kubernetes is a system for running and managing containers across a cluster of
machines (see [Glossary](/glossary)). CB8 ships a set of **kustomize** manifests
in `packaging/k8s/` — these are the configuration files Kubernetes reads, and
kustomize is the tool that applies them. They deploy the same three pieces as the
[Docker](/installation/docker) setup, plus two **optional** GPU services for
semantic e-book search and HD comic upscaling.

> The base manifests are tuned for the author's home cluster and **must** be
> edited before they work on yours. The **"Step 2 — What you must change"**
> section below calls out every value that is specific to the author's setup.

If you just want CB8 on a single host, [Docker](/installation/docker) is far
simpler.

## The manifests

All in `packaging/k8s/`:

| File | What it deploys |
| --- | --- |
| `cb8.yaml` | Namespace `cb8`, the `cb8` API Deployment (containerPort 8008), and a `Service` of type `LoadBalancer` on port **4218**. Also a PVC for the upscale cache. |
| `postgres.yaml` | `cb8-postgres` Deployment (`pgvector/pgvector:pg18`), a PVC, and a `Service` `cb8-postgres:5432`. |
| `worker.yaml` | `cb8-worker` Deployment — same image as `cb8`, run with `command: ["/usr/bin/tini", "--", "node", "/app/dist/worker.mjs"]`. No Service (no HTTP). |
| `embeddings.yaml` | **Optional** GPU service `cb8-embeddings` (Hugging Face TEI). |
| `upscale.yaml` | **Optional** GPU service `cb8-upscale` (Real-ESRGAN). |
| `kustomization.yaml` | Lists the resources above and pins the image tag (`images:` → `newTag`). |

The server **requires** Postgres and creates its schema (including the `vector`
extension) automatically on first connect.

## Prerequisites

- A Kubernetes cluster (the base targets k3s) and `kubectl` pointed at it.
- A way to satisfy the `LoadBalancer` Service (k3s ships ServiceLB; otherwise
  MetalLB, a cloud LB, or change the Service type).
- Storage for the Postgres PVC and the libraries (see below).
- For the optional GPU services only: a GPU node with the NVIDIA device plugin.

## Step 1 — Create the secrets first

A **secret** in Kubernetes is a safe place to store sensitive values like
passwords and keys, kept out of the plain manifests (see [Glossary](/glossary)).
The manifests do **not** create these for you, so make them yourself in the `cb8`
namespace before applying. (Creating the namespace first is harmless even though
`cb8.yaml` also defines it.)

```bash
kubectl create namespace cb8
```

**`cb8-db`** — the Postgres password (`password`, consumed by the postgres
container) and the full connection string (`url`, read by the app as
`DATABASE_URL`). They must agree:

```bash
kubectl -n cb8 create secret generic cb8-db \
  --from-literal=password='<a-strong-password>' \
  --from-literal=url='postgres://cb8:<a-strong-password>@cb8-postgres:5432/cb8'
```

**`cb8-secrets`** — the better-auth session secret. Generate once and keep it
stable (rotating logs everyone out):

```bash
kubectl -n cb8 create secret generic cb8-secrets \
  --from-literal=better-auth-secret="$(openssl rand -hex 32)"
```

**`registry-s8njee-pull`** — *only if you pull the CB8 image from a private
registry.* This is the image-pull secret referenced by the Deployments. If you
use a public image, drop the `imagePullSecrets` lines from `cb8.yaml` /
`worker.yaml` instead.

```bash
kubectl -n cb8 create secret docker-registry registry-s8njee-pull \
  --docker-server=registry.example.com \
  --docker-username=<user> \
  --docker-password=<token>
```

## Step 2 — What you must change

The base manifests are correct for the author's `freya` k3s node and **will not
work unchanged** on your cluster. Edit these before deploying:

- **Image reference + tag.** `kustomization.yaml` pins
  `registry.s8njee.com/cb8` at a specific `newTag`. Repoint `name:` to your image
  and set `newTag:` to your build. (This rewrites the image for both `cb8` and
  `cb8-worker`.)
- **`nodeSelector`.** `cb8.yaml`, `worker.yaml`, and `postgres.yaml` pin pods to
  `kubernetes.io/hostname: freya`. Change or remove this for your nodes.
- **Library volume sources.** `cb8.yaml` and `worker.yaml` mount `web-uploads`,
  `comics`, and `ebooks` as **NFS** volumes from `192.168.1.156:/mnt/raid6/...`.
  (NFS is a way to share folders over the network; a volume is storage attached to
  a pod — see [Glossary](/glossary).) Repoint these at your own NFS export (or
  switch to hostPaths / PVCs that suit your storage). The comics and ebooks mounts
  are **read-only** — CB8 reads your files but never modifies them.
- **`BETTER_AUTH_TRUSTED_ORIGINS`.** In `cb8.yaml` this is a hardcoded list of
  the author's hosts/ports. Replace it with every origin you reach the app by, or
  logins are rejected as cross-site.
- **Postgres storage.** `postgres.yaml` requests a 50Gi **PVC** (a
  PersistentVolumeClaim — a request for durable storage that outlives the pod; see
  [Glossary](/glossary)) from the default storageClass (k3s local-path). Adjust
  the size/class for your cluster.

The optional GPU manifests also pin `kubernetes.io/hostname: mars`,
`runtimeClassName: nvidia`, registry images, and tolerations — change those too
if you deploy them.

## Step 3 — Deploy

Apply the kustomize overlay:

```bash
kubectl apply -k packaging/k8s
```

This creates the namespace (if missing), Postgres, the API, and the worker.
Postgres self-initializes the `cb8` role and database from its env on first boot;
CB8 then creates its schema on first connect.

## Optional — GPU services

`embeddings.yaml` (semantic e-book search) and `upscale.yaml` (HD comic
upscaling) are **optional**. Skip them and the reader still works fully — you just
lose semantic e-book search and on-the-fly HD upscaling.

They require a **GPU node**:

- `runtimeClassName: nvidia` and an `nvidia.com/gpu` resource limit.
- The NVIDIA device plugin installed. A manifest is provided at
  `packaging/embeddings/nvidia-device-plugin.yaml`.

When deployed, the `cb8` and `cb8-worker` pods reach them in-cluster at
`http://cb8-embeddings:8000/v1/embeddings` and `http://cb8-upscale:8000/upscale`
(already wired via `EMBED_URL` / `UPSCALE_URL` in the manifests). They are listed
in `kustomization.yaml`, so to skip them, remove `embeddings.yaml` and
`upscale.yaml` from its `resources:` list.

## Optional — GitOps with Argo CD

`packaging/argocd/cb8.yaml` is an Argo CD `Application` that watches
`packaging/k8s` and keeps the `cb8` namespace in sync (automated sync, selfHeal,
prune). Bootstrap it once with `kubectl apply -f packaging/argocd/cb8.yaml`. The
secrets above must already exist — Argo does not manage them. Edit its `repoURL`
and `targetRevision` for your fork/branch.

## Verify

A **pod** is the unit Kubernetes runs your containers in (see [Glossary](/glossary)).
Check that the pods are running and the Service has an address:

```bash
kubectl -n cb8 get pods,svc
```

**What you should see:** the `cb8`, `cb8-postgres`, and `cb8-worker` pods all in
`Running` state, and the `cb8` Service showing an external IP on port 4218. The
first deploy can take a minute while images pull and Postgres initializes — if a
pod is still `ContainerCreating` or `Pending`, give it a moment and run the
command again.

### First-run admin password

On a fresh database CB8 prints the generated `admin` password to stdout. Read it
from the API Deployment's logs:

```bash
kubectl -n cb8 logs deploy/cb8 | grep -i password
```

## First steps after install

Browse to the LoadBalancer address on port 4218, sign in as `admin`, and add
`/comics` and `/ebooks` as library paths to trigger the first scan. See
[/usage](/usage) for details, and [/configuration](/configuration) for the full
environment-variable reference.
