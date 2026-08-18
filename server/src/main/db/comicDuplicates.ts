import type { Db } from './pg';

/**
 * Check if a comic with this content hash already exists.
 */
export async function comicExistsByHash(db: Db, contentHash: string): Promise<number | null> {
  const row = await db.get<{ id: number }>('SELECT id FROM comics WHERE content_hash = ? LIMIT 1', [contentHash]);
  return row?.id ?? null;
}

/** One record inside a duplicate group, for the admin review screen. */
export interface DuplicateGroupMember {
  id: number;
  title: string;
  filePath: string;
  fileSize: number;
  dateAdded: string;
}

/** A duplicate group as surfaced to the admin UI. */
export interface DuplicateGroup {
  /** `exact` = byte-identical copies (same content hash). `likely` = same series+volume, different files. */
  kind: 'exact' | 'likely';
  key: string;
  /** Human label: the first member's title, or a series/volume description. */
  title: string;
  members: DuplicateGroupMember[];
}

const DUPLICATE_MEMBER_COLUMNS = `id, title, file_path, file_size, date_added`;

export function mapDuplicateMember(row: {
  id: number;
  title: string;
  file_path: string;
  file_size: number;
  date_added: string;
}): DuplicateGroupMember {
  return {
    id: row.id,
    title: row.title,
    filePath: row.file_path,
    fileSize: row.file_size,
    dateAdded: row.date_added,
  };
}

/**
 * Find duplicate groups for the admin review screen.
 */
export async function findDuplicateGroups(db: Db): Promise<DuplicateGroup[]> {
  const groups: DuplicateGroup[] = [];

  const exactRows = await db.all<{ content_hash: string }>(
    `SELECT content_hash FROM comics
     WHERE content_hash IS NOT NULL
     GROUP BY content_hash HAVING count(*) > 1`,
  );
  const exactHashes = new Set(exactRows.map((r) => r.content_hash));

  for (const row of exactRows) {
    const memberRows = await db.all<{
      id: number; title: string; file_path: string; file_size: number; date_added: string;
    }>(
      `SELECT ${DUPLICATE_MEMBER_COLUMNS} FROM comics
       WHERE content_hash = ? ORDER BY date_added DESC`,
      [row.content_hash],
    );
    const members = memberRows.map(mapDuplicateMember);
    groups.push({
      kind: 'exact',
      key: row.content_hash,
      title: members[0]?.title ?? 'Exact copy',
      members,
    });
  }

  const likelyRows = await db.all<{ series_name: string; volume_number: number }>(
    `SELECT series_name, volume_number FROM comics
     WHERE series_name IS NOT NULL AND volume_number IS NOT NULL
     GROUP BY series_name, volume_number HAVING count(*) > 1`,
  );
  for (const row of likelyRows) {
    const rows = await db.all<{
      id: number; title: string; file_path: string; file_size: number; date_added: string; content_hash: string | null;
    }>(
      `SELECT ${DUPLICATE_MEMBER_COLUMNS}, content_hash FROM comics
       WHERE series_name = ? AND volume_number = ? ORDER BY date_added DESC`,
      [row.series_name, row.volume_number],
    );
    // Exact-duplicate members are already shown in their hash group; drop them
    // here so the likely list only surfaces genuinely distinct files.
    const members = rows
      .filter((r) => r.content_hash === null || !exactHashes.has(r.content_hash))
      .map(({ content_hash: _hash, ...member }) => mapDuplicateMember(member));
    if (members.length < 2) continue;
    groups.push({
      kind: 'likely',
      key: `${row.series_name} #${row.volume_number}`,
      title: `${row.series_name} — vol. ${row.volume_number}`,
      members,
    });
  }

  return groups;
}
