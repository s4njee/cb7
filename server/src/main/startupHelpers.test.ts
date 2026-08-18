import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  DEFAULT_WEB_SERVER_PORT,
  isHeadlessMode,
  resolveAppIconPath,
  resolveRendererUrl,
  resolveUserDataPaths,
  resolveWebServerPort,
} from './startupHelpers';

describe('startupHelpers', () => {
  it('detects headless mode from CLI args or environment', () => {
    expect(isHeadlessMode(['cb8', '--headless'], {})).toBe(true);
    expect(isHeadlessMode(['cb8'], { CB8_HEADLESS: '1' })).toBe(true);
    expect(isHeadlessMode(['cb8'], { CB8_HEADLESS: 'true' })).toBe(false);
  });

  it('resolves all paths rooted under Electron userData', () => {
    const paths = resolveUserDataPaths('/Users/example/Library/Application Support/CB8');

    expect(paths).toEqual({
      dbPath: path.join('/Users/example/Library/Application Support/CB8', 'library.db'),
      imageCacheRoot: path.join('/Users/example/Library/Application Support/CB8', 'image-cache'),
      uploadRoot: '/Users/example/Library/Application Support/CB8',
    });
  });

  it('uses the default port when no saved setting exists', () => {
    expect(resolveWebServerPort(null)).toBe(DEFAULT_WEB_SERVER_PORT);
    expect(resolveWebServerPort(undefined)).toBe(DEFAULT_WEB_SERVER_PORT);
    expect(resolveWebServerPort('')).toBe(DEFAULT_WEB_SERVER_PORT);
  });

  it('clamps saved ports into the non-privileged range', () => {
    expect(resolveWebServerPort('80')).toBe(1024);
    expect(resolveWebServerPort('8008')).toBe(8008);
    expect(resolveWebServerPort('70000')).toBe(65535);
  });

  it('keeps the existing parseInt behavior for saved port strings', () => {
    expect(resolveWebServerPort('9000abc')).toBe(9000);
  });

  it('resolves the renderer URL from an override or the embedded server port', () => {
    expect(resolveRendererUrl(8123, undefined)).toBe('http://127.0.0.1:8123');
    expect(resolveRendererUrl(8123, 'http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('resolves packaged and development icon paths', () => {
    expect(resolveAppIconPath({
      isPackaged: true,
      resourcesPath: '/Applications/CB8.app/Contents/Resources',
      runtimeDir: '/unused',
    })).toBe(path.join('/Applications/CB8.app/Contents/Resources', 'book.png'));

    expect(resolveAppIconPath({
      isPackaged: false,
      resourcesPath: '/unused',
      runtimeDir: '/Users/example/CB8/dist/main',
    })).toBe(path.join('/Users/example/CB8/dist/main', '../../book.png'));
  });
});
