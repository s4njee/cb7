import type { Db } from './pg';
import type { SqlParam } from './types';

/**
 * @module
 * Per-user library access (P1-1).
 *
 * A collection (`libraries`) is either public (`everyone = true`, the default)
 * or restricted to explicit `library_members`. These helpers produce the SQL
 * conditions every comic/library query needs so that a user never sees rows
 * they aren't entitled to, without each query re-deriving the rule.
 *
 * Rules:
 *  - A **comic** is visible when it belongs to at least one library that is
 *    public OR the user is a member of, or when it belongs to no library at
 *    all (uncollected → public by default).
 *  - A **library** is visible when public OR the user is a member.
 *  - Guests (`userId = null`) only see public libraries (+ uncollected comics).
 *  - Admins skip these conditions entirely (callers gate on `isAdmin`).
 */

/**
 * WHERE condition restricting `comics c` to the rows the user may see.
 * Callers skip this for admins. `userId` null = guest.
 * @param userId The current user id, or null for guests.
 * @param alias Table alias for the comics row (default `c`). Must be a trusted identifier.
 * @returns The condition fragment and its bound params.
 */
export function comicVisibilityCondition(
  userId: number | null,
  alias = 'c',
): { sql: string; params: SqlParam[] } {
  return {
    sql: `(
      NOT EXISTS (SELECT 1 FROM library_comics vl WHERE vl.comic_id = ${alias}.id)
      OR EXISTS (
        SELECT 1 FROM library_comics vl2
        JOIN libraries vl3 ON vl3.id = vl2.library_id
        WHERE vl2.comic_id = ${alias}.id
          AND (vl3.everyone = true
               OR EXISTS (SELECT 1 FROM library_members vm WHERE vm.library_id = vl3.id AND vm.user_id = ?))
      )
    )`,
    params: [userId],
  };
}

/**
 * WHERE condition restricting `libraries l` to the rows the user may see.
 * Callers skip this for admins. `userId` null = guest.
 * @param userId The current user id, or null for guests.
 * @returns The condition fragment (aliased to `l`) and its bound params.
 */
export function libraryVisibilityCondition(userId: number | null): { sql: string; params: SqlParam[] } {
  return {
    sql: '(l.everyone = true OR EXISTS (SELECT 1 FROM library_members vm WHERE vm.library_id = l.id AND vm.user_id = ?))',
    params: [userId],
  };
}

/**
 * Whether a single comic is visible to the given user (or guest). Admins are
 * always allowed — callers pass `admin` to skip the lookup.
 * Used by `requireComic`/`requireComicLite` so opening a restricted book is a
 * clean 404 rather than an empty page or a leak.
 * @returns True when the comic exists and the user may see it.
 */
export async function comicIsVisible(db: Db, comicId: number, userId: number | null): Promise<boolean> {
  const row = await db.get<{ one: number }>(
    `SELECT 1 as one FROM comics c WHERE c.id = ?
       AND (
         NOT EXISTS (SELECT 1 FROM library_comics vl WHERE vl.comic_id = c.id)
         OR EXISTS (
           SELECT 1 FROM library_comics vl2
           JOIN libraries vl3 ON vl3.id = vl2.library_id
           WHERE vl2.comic_id = c.id
             AND (vl3.everyone = true
                  OR EXISTS (SELECT 1 FROM library_members vm WHERE vm.library_id = vl3.id AND vm.user_id = ?))
         )
       )
     LIMIT 1`,
    [comicId, userId],
  );
  return row !== undefined;
}
