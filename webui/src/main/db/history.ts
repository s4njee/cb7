import type { Db } from './pg';
import type { HistoryResponse } from '../../shared/apiTypes';
import type { CountRow } from './types';

/**
 * @module
 * Database Operations for Reading History
 *
 * Architecture overview for Junior Devs:
 * Owns the `reading_history` table — an append-only log of user actions (e.g.
 * opened, read a page) with a timestamp. Used for activity/recency features,
 * and (P1-7) the per-user reading-stats rollups in `getReadingStats`. Free
 * functions taking the async DB handle, surfaced through `libraryDatabase.ts`.
 */

export async function logHistory(db: Db, userId: number, comicId: number, action: string, page: number | null): Promise<void> {
  await db.run('INSERT INTO reading_history (user_id, comic_id, action, page) VALUES (?, ?, ?, ?)', [userId, comicId, action, page]);
}

export async function getHistory(
  db: Db,
  userId: number,
  offset: number,
  limit: number,
): Promise<HistoryResponse> {
  const countRow = await db.get<CountRow>('SELECT COUNT(*) as cnt FROM reading_history WHERE user_id = ?', [userId]);
  const totalCount = countRow?.cnt ?? 0;
  const rows = await db.all<{ id: number; comic_id: number; comic_title: string | null; action: string; page: number | null; timestamp: string }>(
    `SELECT h.id, h.comic_id, c.title as comic_title, h.action, h.page, h.timestamp
     FROM reading_history h
     LEFT JOIN comics c ON h.comic_id = c.id
     WHERE h.user_id = ?
     ORDER BY h.timestamp DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset],
  );
  return {
    entries: rows.map((r) => ({
      id: r.id, comicId: r.comic_id, comicTitle: r.comic_title ?? '(deleted)',
      action: r.action, page: r.page, timestamp: r.timestamp,
    })),
    totalCount,
  };
}

// ---------------------------------------------------------------------------
// Reading stats (P1-7) — aggregate `reading_history` into a light per-user
// picture: pages/sessions over rolling windows, the current streak, and the
// user's top authors/series. No new table; the append-only log is enough.
// ---------------------------------------------------------------------------

/** Per-window counters for pages and reading sessions. */
export interface ReadingStatWindow {
  week: number;
  month: number;
  year: number;
}

/** A top-authors / top-series row. */
export interface ReadingStatRank {
  name: string;
  count: number;
}

/** The per-user reading summary returned by `GET /api/stats`. */
export interface ReadingStats {
  pages: ReadingStatWindow;
  sessions: ReadingStatWindow;
  /** Consecutive days with a reading action, counting back from today (or yesterday). */
  streak: number;
  topAuthors: ReadingStatRank[];
  topSeries: ReadingStatRank[];
}

/** Actions that count as "reading activity" for stats/streak purposes. */
const READING_ACTIONS = `('opened','closed','read','open')`;

/** Start-of-day boundary (UTC, stored-format text) `days` ago. */
function daysAgoUtc(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} 00:00:00`;
}

/**
 * Count pages read in a window: per comic, the span from the first to the last
 * logged page (`MAX(page) - MIN(page)`), clamped to ≥ 1 so a book opened but
 * only logged with a single position still counts, and null-page logs (EPUBs
 * log `closed` with a null page) still register as one page.
 */
async function pagesInWindow(db: Db, userId: number, since: string): Promise<number> {
  const row = await db.get<{ pages: number }>(
    `SELECT COALESCE(SUM(GREATEST(COALESCE(max_p - min_p, 1), 1)), 0) as pages FROM (
       SELECT comic_id, MIN(page) as min_p, MAX(page) as max_p
       FROM reading_history
       WHERE user_id = ? AND timestamp >= ? AND action IN ${READING_ACTIONS}
       GROUP BY comic_id
     ) t`,
    [userId, since],
  );
  return row?.pages ?? 0;
}

/** Count reading sessions in a window: distinct (comic, day) pairs. */
async function sessionsInWindow(db: Db, userId: number, since: string): Promise<number> {
  const row = await db.get<{ sessions: number }>(
    `SELECT COUNT(*) as sessions FROM (
       SELECT DISTINCT comic_id, date(timestamp)
       FROM reading_history
       WHERE user_id = ? AND timestamp >= ? AND action IN ${READING_ACTIONS}
     ) t`,
    [userId, since],
  );
  return row?.sessions ?? 0;
}

/**
 * Top authors/series for a user, ranked by distinct comics read. Joins through
 * `comics` so deleted books are excluded (their rows cascade away anyway).
 */
async function topRank(
  db: Db,
  userId: number,
  column: 'author' | 'series_name',
): Promise<ReadingStatRank[]> {
  const rows = await db.all<{ name: string; count: number }>(
    `SELECT c.${column} as name, COUNT(DISTINCT h.comic_id) as count
     FROM reading_history h
     JOIN comics c ON h.comic_id = c.id
     WHERE h.user_id = ? AND c.${column} IS NOT NULL AND c.${column} <> ''
     GROUP BY c.${column}
     ORDER BY count DESC, name ASC
     LIMIT 5`,
    [userId],
  );
  return rows.map((r) => ({ name: r.name, count: r.count }));
}

/** Format a `Date` as the stored UTC `YYYY-MM-DD` day key. */
function utcDayKey(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Parse a `YYYY-MM-DD` day key into a UTC midnight `Date` (month is 1-based in the key). */
function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Compute the current reading streak (consecutive days) from a set of UTC
 * day keys. Pure and injectable for tests. A streak counts back from today if
 * the user read today, else from yesterday (the day isn't over yet); if the
 * most recent reading day is older than yesterday the streak is 0.
 * @param days The distinct UTC `YYYY-MM-DD` day keys the user read on.
 * @param todayKey Optional `YYYY-MM-DD` for "now" (defaults to the real today).
 */
export function computeStreakFromDays(days: string[], todayKey?: string): number {
  const set = new Set(days);
  if (set.size === 0) return 0;
  const today = todayKey ?? utcDayKey(new Date());
  const yesterday = utcDayKey(new Date(parseDayKey(today).getTime() - 86_400_000));
  if (!set.has(today) && !set.has(yesterday)) return 0;

  let cursor = set.has(today) ? parseDayKey(today) : parseDayKey(yesterday);
  let streak = 0;
  while (set.has(utcDayKey(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

/**
 * Per-user reading summary over `reading_history` (P1-7): pages and sessions
 * for the last 7/30/365 days, the current streak, and the user's top
 * authors/series. All queries are this-user-scoped.
 * @param db The database handle.
 * @param userId The user whose stats to compute.
 * @returns The reading stats object.
 */
export async function getReadingStats(db: Db, userId: number): Promise<ReadingStats> {
  const [week, month, year] = await Promise.all([7, 30, 365].map((d) => daysAgoUtc(d)));

  const [pagesWeek, pagesMonth, pagesYear, sessionsWeek, sessionsMonth, sessionsYear] =
    await Promise.all([
      pagesInWindow(db, userId, week),
      pagesInWindow(db, userId, month),
      pagesInWindow(db, userId, year),
      sessionsInWindow(db, userId, week),
      sessionsInWindow(db, userId, month),
      sessionsInWindow(db, userId, year),
    ]);

  const [streak, topAuthors, topSeries] = await Promise.all([
    (async () => {
      const rows = await db.all<{ d: string }>(
        `SELECT DISTINCT date(timestamp)::text as d FROM reading_history
         WHERE user_id = ? AND action IN ${READING_ACTIONS} ORDER BY d DESC`,
        [userId],
      );
      return computeStreakFromDays(rows.map((r) => r.d));
    })(),
    topRank(db, userId, 'author'),
    topRank(db, userId, 'series_name'),
  ]);

  return {
    pages: { week: pagesWeek, month: pagesMonth, year: pagesYear },
    sessions: { week: sessionsWeek, month: sessionsMonth, year: sessionsYear },
    streak,
    topAuthors,
    topSeries,
  };
}
