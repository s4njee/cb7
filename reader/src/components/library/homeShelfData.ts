/** What the top of the shelf offers you before you go looking.
 *
 *  Four questions, four independent rows: what am I part-way through, what
 *  comes next in a series I've finished, what just arrived, and what did I
 *  mark as worth keeping. A row with nothing in it does not appear — an empty
 *  "Favorites" row is worse than no row, because it makes the home surface
 *  look broken rather than uncluttered.
 *
 *  Pure by design. The two shelves answer the four questions differently — the
 *  device shelf sorts its own in-memory catalog, while a server answers with
 *  `/api/continue-reading` and two small list queries — so the *sources* differ
 *  and the shelf-building does not. Both feed this one function.
 */
import type { WebComicRecord } from "../../lib/api";
import { hasStarted, isFinished } from "../../lib/format";
import { pickSequel } from "../flows/sequel";

export type HomeShelfKey = "continue" | "next" | "recent" | "favorites";

export interface HomeShelf {
  key: HomeShelfKey;
  title: string;
  records: WebComicRecord[];
}

export interface HomeSources {
  /** Started but unfinished, most recently read first. */
  continueReading: WebComicRecord[];
  /** Newest first. */
  recentlyAdded: WebComicRecord[];
  favorites: WebComicRecord[];
  /** Everything on hand, for the sequel heuristic to search for siblings. */
  pool: WebComicRecord[];
}

const DEFAULT_LIMIT = 12;

function byLastRead(a: WebComicRecord, b: WebComicRecord): number {
  return (b.lastRead ?? "").localeCompare(a.lastRead ?? "");
}

function byDateAdded(a: WebComicRecord, b: WebComicRecord): number {
  return (b.dateAdded ?? "").localeCompare(a.dateAdded ?? "");
}

/** Derive all four sources from an in-memory catalog — the on-device shelf,
 *  which holds everything it has and so can answer without asking anyone. */
export function localHomeSources(records: WebComicRecord[]): HomeSources {
  return {
    continueReading: records.filter((r) => hasStarted(r) && !isFinished(r)).sort(byLastRead),
    recentlyAdded: [...records].sort(byDateAdded),
    favorites: records.filter((r) => r.favorited),
    pool: records,
  };
}

/** The next unread volume after each series you have finished.
 *
 *  Driven by finished books (newest first), because that is when the question
 *  actually arises. Anything already started is excluded — it belongs to
 *  "Continue reading", and a book cannot be both what you are reading and what
 *  you should read next. */
function upNext(sources: HomeSources, limit: number): WebComicRecord[] {
  const finished = sources.pool.filter(isFinished).sort(byLastRead);
  const out: WebComicRecord[] = [];
  const seen = new Set<number>();
  for (const done of finished) {
    const next = pickSequel(done, sources.pool);
    if (!next || seen.has(next.id) || hasStarted(next)) continue;
    seen.add(next.id);
    out.push(next);
    if (out.length >= limit) break;
  }
  return out;
}

/** Build the home rows, dropping any that came out empty.
 *
 *  Rows are independent and may overlap: a favorite that arrived yesterday
 *  belongs in both "Recently added" and "Favorites", and hiding it from one
 *  would answer that row's question wrongly. The single exception is "Up next",
 *  which excludes anything already in progress — see `upNext`.
 */
export function buildHomeShelves(sources: HomeSources, limit = DEFAULT_LIMIT): HomeShelf[] {
  const shelves: HomeShelf[] = [
    { key: "continue", title: "Continue reading", records: sources.continueReading.slice(0, limit) },
    { key: "next", title: "Up next in series", records: upNext(sources, limit) },
    { key: "recent", title: "Recently added", records: sources.recentlyAdded.slice(0, limit) },
    { key: "favorites", title: "Favorites", records: sources.favorites.slice(0, limit) },
  ];
  return shelves.filter((shelf) => shelf.records.length > 0);
}
