/**
 * @module
 * Destructive Library-Wide Maintenance Operations
 *
 * Architecture overview for Junior Devs:
 * This is the "Clear Library" feature. It deletes all catalog data — comics,
 * tags, libraries, folders, per-user reading state, dismissed paths — in one
 * transaction.
 *
 * What it deliberately keeps: users, sessions, accounts, and the `app_meta`
 * table (which stores the auth secret, the initial admin password, theme
 * preferences, and the schema version). Preserving these means the operator
 * stays signed in and the app reboots into a known-good state.
 *
 * What it never touches: the actual files on disk. CB8 only removes database
 * rows; your comics stay where they are.
 */
import type { CountRow } from './types';
import type { Db, PgDatabase } from './pg';

/** Row counts captured *before* the wipe, returned for reporting. */
export interface ClearLibraryResult {
  comics: number;
  tags: number;
  libraries: number;
  folders: number;
  dismissedPaths: number;
}

async function countRows(db: Db, table: string): Promise<number> {
  const row = await db.get<CountRow>(`SELECT COUNT(*) AS cnt FROM ${table}`);
  return row?.cnt ?? 0;
}

/**
 * Wipe the media catalog while preserving users and app settings.
 * @param db The async database handle (needs its own transaction).
 * @returns The row counts that existed before deletion (for an operator report).
 */
export async function clearLibrary(db: PgDatabase): Promise<ClearLibraryResult> {
  const before = {
    comics: await countRows(db, 'comics'),
    tags: await countRows(db, 'tags'),
    libraries: await countRows(db, 'libraries'),
    folders: await countRows(db, 'folders'),
    dismissedPaths: await countRows(db, 'dismissed_paths'),
  };

  await db.tx(async (tx) => {
    // Parents first; ON DELETE CASCADE on the junction tables handles the
    // intermediate rows. `comics` cascades to user_progress, bookmarks,
    // reading_history, user_favorites, and the remaining junction rows; the
    // generated search_vector column needs no separate upkeep.
    await tx.run('DELETE FROM libraries');
    await tx.run('DELETE FROM folders');
    await tx.run('DELETE FROM tags');
    await tx.run('DELETE FROM comics');
    await tx.run('DELETE FROM dismissed_paths');
  });

  // (Postgres IDENTITY sequences keep counting; there's no need to reset them
  // the way the SQLite path cleared sqlite_sequence.)
  return before;
}
