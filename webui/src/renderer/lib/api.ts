/**
 * @module
 * Public Renderer API Barrel
 *
 * Architecture overview for Junior Devs:
 * This file re-exports everything from `src/renderer/lib/api/`. UI code should
 * import from `@/lib/api` and never reach into the individual modules directly.
 * The real implementations are split by domain (comics, folders, reading, ...)
 * inside the `api/` folder, so when you add or debug an endpoint you open one
 * small focused file instead of a giant one.
 */
export * from './api/index';
