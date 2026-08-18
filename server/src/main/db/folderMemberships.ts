import type { Db, PgDatabase } from './pg';
import { initialFolderCoverUpdateId } from './folderRecordHelpers';

export async function insertFolderComicMemberships(
  db: Db,
  folderId: number,
  comicIds: number[],
): Promise<void> {
  for (const id of comicIds) {
    await db.run('INSERT INTO folder_comics (folder_id, comic_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [folderId, id]);
  }
}

export async function updateInitialFolderCover(
  db: Db,
  folderId: number,
  comicIds: number[],
): Promise<void> {
  const folder = await db.get<{ cover_comic_id: number | null }>('SELECT cover_comic_id FROM folders WHERE id = ?', [folderId]);
  const coverId = initialFolderCoverUpdateId(folder?.cover_comic_id, comicIds);
  if (coverId != null) {
    await db.run('UPDATE folders SET cover_comic_id = ? WHERE id = ?', [coverId, folderId]);
  }
}

export async function addFolderMembershipsRaw(
  db: Db,
  folderId: number,
  comicIds: number[],
): Promise<void> {
  if (comicIds.length === 0) return;
  await insertFolderComicMemberships(db, folderId, comicIds);
  await updateInitialFolderCover(db, folderId, comicIds);
}

export function addComicsToFolderRaw(db: Db, folderId: number, comicIds: number[]): Promise<void> {
  return addFolderMembershipsRaw(db, folderId, comicIds);
}

export async function addComicsToFolder(db: PgDatabase, folderId: number, comicIds: number[]): Promise<void> {
  if (!comicIds.length) return;
  await db.tx(async (tx) => {
    await addFolderMembershipsRaw(tx, folderId, comicIds);
  });
}

export async function removeComicsFromFolder(db: PgDatabase, folderId: number, comicIds: number[]): Promise<void> {
  if (!comicIds.length) return;
  const placeholders = comicIds.map(() => '?').join(',');
  await db.tx(async (tx) => {
    await tx.run(`DELETE FROM folder_comics WHERE folder_id = ? AND comic_id IN (${placeholders})`, [folderId, ...comicIds]);
  });
}

export async function getComicFolderIds(db: Db, comicId: number): Promise<number[]> {
  const rows = await db.all<{ folder_id: number }>('SELECT folder_id FROM folder_comics WHERE comic_id = ?', [comicId]);
  return rows.map((r) => r.folder_id);
}

export async function getFolderFilePaths(db: Db, folderId: number): Promise<string[]> {
  const rows = await db.all<{ file_path: string }>(
    `SELECT c.file_path FROM comics c
     JOIN folder_comics fc ON fc.comic_id = c.id
     WHERE fc.folder_id = ?`,
    [folderId],
  );
  return rows.map((r) => r.file_path);
}
