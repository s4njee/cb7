import type { Db } from './pg';

export async function setFolderScanRoot(db: Db, id: number, scanPath: string | null): Promise<void> {
  await db.run('UPDATE folders SET scan_path = ? WHERE id = ?', [scanPath, id]);
}

export async function setFolderAutoScanEnabled(db: Db, id: number, enabled: boolean): Promise<void> {
  await db.run('UPDATE folders SET auto_scan_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

export async function getFolderScanRoot(db: Db, id: number): Promise<string | null> {
  const row = await db.get<{ scan_path: string | null }>('SELECT scan_path FROM folders WHERE id = ?', [id]);
  return row?.scan_path ?? null;
}

export async function folderExists(db: Db, id: number): Promise<boolean> {
  const row = await db.get('SELECT 1 FROM folders WHERE id = ?', [id]);
  return row !== undefined;
}

/**
 * List every folder that has a registered `scan_path` (drop-folder root).
 */
export async function getWatchedRoots(
  db: Db,
): Promise<Array<{
  id: number;
  folderId?: number;
  name: string;
  scanPath: string;
  autoScanEnabled: boolean;
  comicCount: number;
}>> {
  const rows = await db.all<{
    id: number;
    name: string;
    scan_path: string;
    auto_scan_enabled: number;
    comic_count: number;
  }>(
    `SELECT f.id, f.name, f.scan_path, f.auto_scan_enabled,
            (SELECT COUNT(*) FROM folder_comics WHERE folder_id = f.id) as comic_count
     FROM folders f
     WHERE f.scan_path IS NOT NULL AND f.scan_path != ''
     ORDER BY lower(f.name)`,
  );

  return rows.map((r) => ({
    id: r.id,
    folderId: r.id,
    name: r.name,
    scanPath: r.scan_path,
    autoScanEnabled: r.auto_scan_enabled === 1,
    comicCount: r.comic_count,
  }));
}
