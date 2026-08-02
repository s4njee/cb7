/** Local reading-session statistics — per-day totals kept on-device, keyed by
 *  server. No server round-trip: the CB8 API tracks history/progress, but not
 *  "how long did I read today", so we accumulate wall-clock reading time and
 *  page turns here and derive the week view / streak / top-books from it.
 *
 *  Storage: `shelf.stats.<serverUrl>` →
 *    { [yyyy-mm-dd]: { ms, pages, books: { [comicId]: { ms, pages, title } } } }
 *  capped at the most recent 180 days.
 *
 *  Everything below the `startSession` line is a pure function of the stored
 *  shape so the sheet can render (and be reasoned about) without any clock. */

export interface BookDayStat {
  ms: number;
  pages: number;
  title: string;
}

export interface DayStat {
  ms: number;
  pages: number;
  books: Record<string, BookDayStat>;
}

export type StatsData = Record<string, DayStat>;

const MAX_DAYS = 180;
/** A single flush can't credit more than this much time — guards against a
 *  device that slept for hours between heartbeats being counted as reading. */
const MAX_FLUSH_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function storageKey(serverUrl: string): string {
  return `shelf.stats.${serverUrl}`;
}

/** Local (not UTC) yyyy-mm-dd — the day boundary a reader experiences. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function readStats(serverUrl: string): StatsData {
  try {
    const raw = localStorage.getItem(storageKey(serverUrl));
    return raw ? (JSON.parse(raw) as StatsData) : {};
  } catch {
    return {};
  }
}

function writeStats(serverUrl: string, data: StatsData): void {
  // Cap at the most recent MAX_DAYS keys (yyyy-mm-dd sorts lexically = chrono).
  const keys = Object.keys(data).sort();
  if (keys.length > MAX_DAYS) {
    for (const k of keys.slice(0, keys.length - MAX_DAYS)) delete data[k];
  }
  try {
    localStorage.setItem(storageKey(serverUrl), JSON.stringify(data));
  } catch {
    /* storage full/blocked — stats are best-effort */
  }
}

/** Fold a chunk of reading (ms + page turns) into today's bucket for a book. */
function accumulate(
  serverUrl: string,
  comicId: number,
  title: string,
  ms: number,
  pages: number,
): void {
  if (ms <= 0 && pages <= 0) return;
  const data = readStats(serverUrl);
  const key = dayKey(new Date());
  const day: DayStat = data[key] ?? { ms: 0, pages: 0, books: {} };
  day.ms += ms;
  day.pages += pages;
  const id = String(comicId);
  const book: BookDayStat = day.books[id] ?? { ms: 0, pages: 0, title };
  book.ms += ms;
  book.pages += pages;
  book.title = title; // keep the freshest title
  day.books[id] = book;
  data[key] = day;
  writeStats(serverUrl, data);
}

/* -------------------------------------------------------------- live session */

export interface ReadingSession {
  /** Called whenever the reader's page number advances. */
  onPageAdvance: () => void;
  /** Wire to visibilitychange: pauses the clock while the tab/app is hidden. */
  setVisible: (visible: boolean) => void;
  /** Flush and tear down. Safe to call more than once. */
  stop: () => void;
}

/** Start tracking a reading session for one open book. The clock only runs
 *  while the document is visible; time is flushed on a heartbeat, on pause,
 *  and on stop so a crash loses at most one interval of reading. */
export function startSession(
  serverUrl: string,
  comicId: number,
  title: string,
): ReadingSession {
  let visible =
    typeof document === "undefined" || document.visibilityState !== "hidden";
  let lastTick: number | null = visible ? Date.now() : null;
  let pendingPages = 0;
  let stopped = false;

  const flush = () => {
    const now = Date.now();
    let ms = 0;
    if (lastTick != null) {
      ms = Math.min(Math.max(0, now - lastTick), MAX_FLUSH_MS);
      lastTick = now;
    }
    const pages = pendingPages;
    pendingPages = 0;
    accumulate(serverUrl, comicId, title, ms, pages);
  };

  const interval =
    typeof window === "undefined"
      ? (0 as unknown as number)
      : window.setInterval(flush, 15000);

  return {
    onPageAdvance() {
      pendingPages += 1;
    },
    setVisible(v: boolean) {
      if (stopped || v === visible) return;
      visible = v;
      if (v) {
        lastTick = Date.now();
      } else {
        flush();
        lastTick = null;
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      flush();
      if (typeof window !== "undefined") window.clearInterval(interval);
    },
  };
}

/* ------------------------------------------------------------- pure selectors */

export interface DayBar {
  key: string;
  /** Short weekday initial(s), e.g. "Mon". */
  label: string;
  minutes: number;
  isToday: boolean;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** The 7 days ending today (oldest first), minutes read each day. */
export function weekBars(data: StatsData, now = new Date()): DayBar[] {
  const todayKey = dayKey(now);
  const bars: DayBar[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(now, -i);
    const key = dayKey(d);
    const ms = data[key]?.ms ?? 0;
    bars.push({
      key,
      label: WEEKDAY[d.getDay()],
      minutes: Math.round(ms / 60000),
      isToday: key === todayKey,
    });
  }
  return bars;
}

export interface Totals {
  todayMs: number;
  weekMs: number;
  weekPages: number;
}

/** Time today, plus time + pages across the trailing 7 days (inclusive). */
export function totals(data: StatsData, now = new Date()): Totals {
  const todayKey = dayKey(now);
  const weekKeys = new Set<string>();
  for (let i = 0; i < 7; i++) weekKeys.add(dayKey(addDays(now, -i)));
  let weekMs = 0;
  let weekPages = 0;
  for (const key of weekKeys) {
    const day = data[key];
    if (!day) continue;
    weekMs += day.ms;
    weekPages += day.pages;
  }
  return { todayMs: data[todayKey]?.ms ?? 0, weekMs, weekPages };
}

/** Consecutive days with any reading (ms > 0) ending today (or yesterday, so a
 *  streak isn't "broken" simply because you haven't opened a book yet today). */
export function currentStreak(data: StatsData, now = new Date()): number {
  const hasRead = (d: Date) => (data[dayKey(d)]?.ms ?? 0) > 0;
  let start = 0;
  if (!hasRead(now)) {
    if (hasRead(addDays(now, -1))) start = 1;
    else return 0;
  }
  let streak = 0;
  for (let i = start; ; i++) {
    if (hasRead(addDays(now, -i))) streak++;
    else break;
  }
  return streak;
}

export interface TopBook {
  comicId: number;
  title: string;
  ms: number;
  pages: number;
}

/** Books read most (by time) across the trailing 7 days. */
export function topBooks(data: StatsData, now = new Date(), limit = 5): TopBook[] {
  const agg = new Map<string, TopBook>();
  for (let i = 0; i < 7; i++) {
    const day = data[dayKey(addDays(now, -i))];
    if (!day) continue;
    for (const [id, b] of Object.entries(day.books)) {
      const cur = agg.get(id) ?? { comicId: Number(id), title: b.title, ms: 0, pages: 0 };
      cur.ms += b.ms;
      cur.pages += b.pages;
      cur.title = b.title;
      agg.set(id, cur);
    }
  }
  return [...agg.values()]
    .filter((b) => b.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit);
}

/* ---------------------------------------------------------------- formatting */

/** "12 min", "1 h 05 m", "0 min". Minutes floor; hours once past 60. */
export function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} h ${String(m).padStart(2, "0")} m`;
}
