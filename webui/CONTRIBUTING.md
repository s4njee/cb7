# Contributing To CB8

This guide is the short path for new contributors. If you are not sure where
something lives, start here, then use `ARCHITECTURE.md` for the deeper map.

## Quick Start

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm build:renderer
pnpm build:standalone
DATABASE_URL=postgres://cb8:pw@localhost:5432/cb8 pnpm start:standalone
```

`pnpm test` runs Vitest on plain Node. Suites that need a real database are
skipped unless `CB8_TEST_DATABASE_URL` points at a disposable Postgres (use a
throwaway `pgvector/pgvector` container — the suites TRUNCATE tables).

For frontend-only work, run the API in one terminal (`start:standalone` above)
and the renderer dev server in another:

```sh
pnpm dev:renderer
```

The renderer dev server proxies `/api` to the CB8 server.

## Current Architecture

CB8 is a standalone Node server (no Electron — that era is retired; the native
client is the Flutter app at the repo root). Three main areas:

- `src/main/`: the Fastify API (`standalone.ts`), the pg-boss background worker
  (`worker.ts`), the Postgres layer, ingest, and archive loading.
- `src/renderer/`: React SPA UI.
- `src/shared/`: pure types and helpers that both sides may import.

## Adding A Server Endpoint

Most endpoints still live in raw route modules under
`src/main/webServer/routes/`. Use the existing helper pattern instead of adding
new parsing by hand.

1. Pick the route file by resource: `progress.ts`, `folders.ts`, `comics.ts`,
   and so on.
2. Parse path ids with a clear regex and `parseInt`.
3. Use helpers from `routes/validation.ts` for common checks:
   - `requireCurrentUser(ctx)`
   - `requireComic(ctx, id)`
   - `readJsonBody<T>(req, res)`
   - `parseBoundedInteger(...)`
   - `readPageIndex(...)`
4. Return JSON through `sendJson()` / `sendError()`.
5. Add or update a route test when behavior or auth gating changes.

For new response shapes, put the type in `src/shared/apiTypes.ts` first, then
import that type from both the server and renderer.

## Keeping Route Code Tidy

Route files should read like request flow: match path, check auth, parse input,
call the database, send a response. When a route has a reusable or easy-to-get
wrong rule, move that rule into a nearby `*Helpers.ts` file and add a colocated
`*.test.ts`.

Good helper candidates:

- query-option builders, such as collection/folder/comic filters
- route guards, such as last-admin or host-only checks
- normalization of raw JSON, query strings, path params, or headers
- response-shaping helpers shared by more than one branch
- small policy decisions with edge cases, such as progress auto-complete

Keep HTTP details in the route file. Helpers should usually accept plain values
and return plain values or tagged results like `{ ok: true }` /
`{ ok: false, error }`. Avoid extracting one-off code just to reduce line count;
extract when the new name teaches the rule or makes it safer to test.

For paged comic/book list responses, use `routes/routeResponseHelpers.ts` so
`/api/comics`, `/api/folders/:id/comics`, and `/api/libraries/:id/comics` keep
the same wire shape.

## Adding A Renderer API Call

Renderer HTTP calls live under `src/renderer/lib/api/`, grouped by domain.
`src/renderer/lib/api.ts` is only a public barrel so existing imports can keep
using `@/lib/api`.

1. Pick the nearest domain module: `comics.ts`, `folders.ts`, `reading.ts`,
   `admin.ts`, and so on.
2. Reuse `get`, `post`, `put`, or `del` from `api/client.ts`.
3. Put renderer-facing types in `api/types.ts`. If the server also returns that
   shape, define it in `src/shared/apiTypes.ts` and import it from both sides.
4. Keep everything on HTTP APIs — the SPA has no privileged host bridge.

## Adding UI

Use existing components before inventing new primitives:

- Layout: `src/renderer/components/layout/`
- Library UI: `src/renderer/components/library/`
- Reader UI: `src/renderer/components/reader/`
- Admin/settings UI: `src/renderer/components/admin/`
- Base controls: `src/renderer/components/ui/`

Use React Query for server data and Zustand only for UI state that needs to
survive across pages.

## Keeping UI Code Tidy

For larger React screens, prefer a controller/view split:

- the main panel/page owns state, queries, mutations, and navigation
- `*Sections.tsx` or `*View.tsx` files own markup and visual states
- pure interaction rules live in `*Helpers.ts` and get unit tests

This keeps a new contributor from having to understand React Query, event
handling, and layout all in the same scroll. Do not split tiny components unless
the new file gets a clear responsibility and a useful name.

Reader components follow the same idea. `ComicReader`, `EpubReader`, and
`PdfReader` should stay focused on lifecycle/state. Put rule-like behavior in
files such as `comicReaderRules.ts`, `pdfReaderRules.ts`, or
`epubReaderIframeEvents.ts`, and cover it with unit tests when it has branches.

## Working In Server Modules

`src/main` files often touch slow or platform-specific systems: Postgres,
archives, spawned binaries, and the filesystem. Keep those boundaries explicit.

- DB operation files should call query/metadata helpers instead of building
  complex SQL fragments inline when the rule is reusable.
- Ingest code separates discovery (`ingestDiscovery.ts`), path inference
  (`ingestPathHelpers.ts`), queueing (`ingestQueue.ts`), and record preparation
  (`ingestService.ts`).
- Archive code separates entry ordering (`archiveEntryHelpers.ts`), page cache
  behavior (`archivePageHelpers.ts`), process/timeout plumbing
  (`archiveProcessHelpers.ts`), and backend orchestration (`archiveLoader.ts`).

When you are not sure where a change belongs, put domain behavior near the
domain module and keep helpers plain enough to unit test without Fastify,
Postgres, or a local media library.

## Adding DB-Backed Tests

Use a temporary `LibraryDatabase`, like `src/main/db/comics.query.test.ts`.
Do not depend on a local comic library.

Good integration tests read like user workflows:

- create user -> login -> fetch session
- add media record -> query library
- update progress -> continue reading
- create folder -> list folder comics

## Before You Hand Off

Run:

```sh
pnpm run typecheck
pnpm test
pnpm build:renderer
```

Mention any skipped check or known warning in your final note.
