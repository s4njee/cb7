# CB8 Documentation Index

Use this file as the map for current vs historical documentation.

## Current Sources

- `README.md` — project overview, features, install targets, first-run notes, and development commands.
- `ARCHITECTURE.md` — implementation architecture notes.
- `DEPLOY.md` — the operational runbook for the production deployment (freya k3s, GitOps via Argo CD).
- `docs/STUDY_GUIDE.md` — junior-dev onboarding tour: what each file does and where to edit for common tasks.
- `docs/DEPLOYMENT.md` — general deployment guide: build targets, Docker, standalone Node, environment variables, Postgres/pgvector and 7-Zip requirements.
- `docs/READER.md` — reader UI behavior (immersive chrome, keyboard bindings) and supported formats.
- `docs/diagrams.md` — small Mermaid diagrams for the main request flows (API, ingest, reader, OPDS).
- `docs/examples/` — copyable examples for adding features.
- `CONTRIBUTING.md` — new-contributor setup and "how to add X" guide.
- `typedoc.json` — TypeDoc config. Run `pnpm docs:api` to generate browsable HTML API docs from the in-source doc blocks into `docs/api/`.
- `packaging/wiki/content/` — the user-facing wiki (installation, configuration, usage, operations, troubleshooting), deployed as a docs site.

> Historical planning docs (an earlier Go/Postgres direction's `requirements.md`,
> `design.md`, `tasks.md`, and the `docs/legacy/` plan archive) were removed when
> CB8 was vendored into the Flutter monorepo under `webui/`. They remain in the
> standalone CB8 repo if needed for context. Docs describing the retired
> Electron/SQLite desktop build have been updated to the current
> Postgres-backed server; the Flutter app at the monorepo root is the native
> client now.
