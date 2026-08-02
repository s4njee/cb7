import type { Db } from './pg';

/**
 * @module
 * Key/Value Settings Store (`app_meta` table)
 *
 * Architecture overview for Junior Devs:
 * `app_meta` is a simple single-row-per-key table that holds app-wide settings
 * that must survive restarts: the auth secret, schema version, guest-access
 * flag, web-server preferences, the initial admin password, and various repair
 * flags. These two helpers are the only way the rest of the app reads/writes it.
 */

/**
 * Read a setting value.
 * @param db The database handle.
 * @param key The setting key.
 * @returns The stored string, or `null` if the key isn't set.
 */
export async function getAppMeta(db: Db, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', [key]);
  return row?.value ?? null;
}

/**
 * Write (insert or overwrite) a setting value.
 * @param db The database handle.
 * @param key The setting key.
 * @param value The string value to store.
 */
export async function setAppMeta(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, value],
  );
}
