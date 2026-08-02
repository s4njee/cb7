# Example: Add A Small Feature

This is a template for tiny end-to-end features. Copy the shape before getting
creative.

Example feature: add an admin-only setting called `example_mode`.

## 1. Add Shared Types

If the route returns a new shape, define it in `src/shared/apiTypes.ts`.

```ts
export interface ExampleModeResponse {
  enabled: boolean;
}
```

## 2. Add Database Access

For simple settings, use `app_meta` through `LibraryDatabase`.

```ts
const raw = db.getAppMeta('example_mode');
const enabled = raw === 'true';
db.setAppMeta('example_mode', enabled ? 'true' : 'false');
```

If the feature needs real tables or joins, add a small function in the matching
`src/main/db/*.ts` file and expose it through `src/main/libraryDatabase.ts`.

## 3. Add A Route

Use a route module under `src/main/webServer/routes/`.

```ts
if (method === 'GET' && pathname === '/api/settings/example-mode') {
  sendJson(res, 200, { enabled: db.getAppMeta('example_mode') === 'true' });
  return true;
}

if (method === 'PUT' && pathname === '/api/settings/example-mode') {
  if (!requireAdmin(ctx)) return true;
  const body = await readJsonBody<{ enabled?: boolean }>(req, res);
  if (!body.ok) return true;
  db.setAppMeta('example_mode', body.value.enabled === true ? 'true' : 'false');
  sendJson(res, 200, { ok: true });
  return true;
}
```

## 4. Add A Renderer API Helper

Put the HTTP call in the nearest module under `src/renderer/lib/api/`.
`src/renderer/lib/api.ts` is only the public barrel that lets UI files keep
importing from `@/lib/api`.

```ts
export const fetchExampleMode = () =>
  get<ExampleModeResponse>('/api/settings/example-mode');

export const setExampleMode = (enabled: boolean) =>
  put<OkResponse>('/api/settings/example-mode', { body: { enabled } });
```

## 5. Add UI

Use existing components from `src/renderer/components/ui/`. For settings,
`src/renderer/components/admin/SettingsPanel.tsx` is the usual place.

## 6. Add Tests

For route behavior, add a test with `server.inject()` in a colocated
`*.test.ts`. Cover at least:

- unauthenticated mutation is rejected;
- admin mutation succeeds;
- GET returns the new value.

## 7. Verify

```sh
pnpm run typecheck
pnpm test
pnpm build:renderer
```
