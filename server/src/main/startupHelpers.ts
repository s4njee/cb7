import path from 'node:path';

/**
 * @module
 * Application Startup Configuration Helpers
 *
 * Architecture overview for Junior Devs:
 * When the app boots it has to make several environment-driven decisions: is it
 * running headless (no Electron window)? where on disk do the database, caches,
 * and uploads live? which port should the web server use, and what URL/icon go
 * with it? These are pure functions that turn raw inputs (argv, env vars, the
 * Electron user-data path) into concrete config values, so the main process stays
 * thin and the decisions are unit-testable without launching the app.
 */

/** Port the embedded web server listens on when none is configured. */
export const DEFAULT_WEB_SERVER_PORT = 8008;

/** The on-disk locations the app reads from and writes to. */
export type UserDataPaths = {
  dbPath: string;
  imageCacheRoot: string;
  uploadRoot: string;
};

/**
 * Determine whether the app should run without an Electron window.
 * @param argv The process arguments.
 * @param env Environment carrying the optional `CB8_HEADLESS` flag.
 * @returns `true` when `--headless` is passed or `CB8_HEADLESS` is `"1"`.
 */
export function isHeadlessMode(argv: readonly string[], env: { CB8_HEADLESS?: string | undefined }): boolean {
  return argv.includes('--headless') || env.CB8_HEADLESS === '1';
}

/**
 * Derive all on-disk data paths from the Electron user-data directory.
 * @param userDataPath The base user-data directory.
 * @returns The resolved database, image-cache, and upload locations.
 */
export function resolveUserDataPaths(userDataPath: string): UserDataPaths {
  return {
    dbPath: path.join(userDataPath, 'library.db'),
    imageCacheRoot: path.join(userDataPath, 'image-cache'),
    uploadRoot: userDataPath,
  };
}

/**
 * Resolve the web-server port, clamped to a valid non-privileged range.
 * Parses the raw value and clamps it to 1024–65535; falls back to
 *          `DEFAULT_WEB_SERVER_PORT` when missing or unparseable.
 * @param rawPort The configured port string, if any.
 * @returns A usable port number.
 */
export function resolveWebServerPort(rawPort: string | null | undefined): number {
  const parsed = rawPort ? parseInt(rawPort, 10) : NaN;
  return Number.isFinite(parsed)
    ? Math.max(1024, Math.min(65535, parsed))
    : DEFAULT_WEB_SERVER_PORT;
}

/**
 * Resolve the URL the Electron window should load.
 * @param port The web-server port (used for the default loopback URL).
 * @param override An explicit URL override, if provided.
 * @returns The override when set, otherwise the local loopback URL.
 */
export function resolveRendererUrl(port: number, override: string | undefined): string {
  return override || `http://127.0.0.1:${port}`;
}

/**
 * Resolve the path to the application icon.
 * Uses the packaged resources directory in production builds and a
 *          path relative to the runtime dir during development.
 * @param options Whether the app is packaged, plus the resources and runtime dirs.
 * @returns The absolute path to the icon image.
 */
export function resolveAppIconPath(options: {
  isPackaged: boolean;
  resourcesPath: string;
  runtimeDir: string;
}): string {
  return options.isPackaged
    ? path.join(options.resourcesPath, 'book.png')
    : path.join(options.runtimeDir, '../../book.png');
}
