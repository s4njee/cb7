import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { LibraryDatabase } from './libraryDatabase';
import { createLogger } from './logger';

const log = createLogger('uploadCleanup');

/**
 * Delete files under `uploadRoot` that no catalog record references and that
 * are older than `olderThanMs`.
 *
 * Orphaned uploads appear when a client aborts mid-stream (the upload route
 * unlinks files it sees fail, but an aborted stream can leave a partial file
 * behind) or after a library wipe (which keeps files by design). Anything
 * younger than the cutoff is left alone so a file that was just uploaded — and
 * whose ingest is still in flight — is never raced.
 *
 * Returns the number of files removed.
 */
export async function sweepOrphanedUploads(
  db: LibraryDatabase,
  uploadRoot: string,
  olderThanMs: number,
): Promise<number> {
  let removed = 0;
  const visited = new Set<string>();

  const visit = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // root missing or not a directory — nothing to sweep
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile() || visited.has(full)) continue;
      visited.add(full);
      if (await db.comicExistsByPath(full)) continue;
      let stat: fs.Stats;
      try {
        stat = await fsp.stat(full);
      } catch {
        continue;
      }
      if (Date.now() - stat.mtimeMs < olderThanMs) continue;
      await fsp.unlink(full).catch(() => {});
      removed += 1;
      log.info(`Removed orphaned upload: ${full}`);
    }
  };

  await visit(uploadRoot);
  return removed;
}
