/** Where the shelf was when you left it.
 *
 *  Opening a book unmounts the whole library screen, so without this every
 *  return trip restarts exploration at the top of "All titles" — punishing
 *  exactly the browsing (deep in a series, three filters in, halfway down the
 *  grid) that took the most effort to set up.
 *
 *  Deliberately module-level rather than persisted: this is *this session's*
 *  place in the shelf, not a preference. A fresh launch should open on a clean
 *  library, so the memory dying with the process is the correct lifetime.
 */
import type { ReadStatus } from "../../lib/api";
import type { Scope } from "./libraryData";

export type Shelf = "local" | "server";
export type Filter = "all" | "comic" | "book";

export interface LibraryView {
  shelf: Shelf | null;
  /** The server this view belonged to, so a server scope is never restored
   *  onto a different library (collection ids are not portable). */
  serverUrl: string | null;
  scope: Scope;
  search: string;
  filter: Filter;
  readStatus: ReadStatus | null;
  favorites: boolean;
  tag: string | null;
  collection: string | null;
  scrollTop: number;
}

let memory: LibraryView | null = null;

export function rememberLibraryView(view: LibraryView): void {
  memory = view;
}

/** The remembered view, or null when there is nothing safe to restore.
 *
 *  A view of a *server* shelf is only valid on the server it was taken from:
 *  collection ids and series names don't carry across libraries, so pointing
 *  the app at a different server drops it rather than landing the user in
 *  someone else's scope. The on-device shelf travels fine. */
export function recallLibraryView(serverUrl: string | null): LibraryView | null {
  if (!memory) return null;
  if (memory.shelf === "server" && memory.serverUrl !== serverUrl) return null;
  return memory;
}

/** Drop the memory outright — signing out changes whose library this is. */
export function forgetLibraryView(): void {
  memory = null;
}

/** The narrowings a shelf can carry — the subset of `LibraryView` that decides
 *  whether anything is being filtered. */
export interface FilterState {
  search: string;
  filter: Filter;
  readStatus: ReadStatus | null;
  favorites: boolean;
  tag: string | null;
  collection: string | null;
  scope: Scope;
}

/** Is any filter narrowing the shelf right now? Drives the "active filters"
 *  bar and the explicit reset affordances. */
export function hasActiveFilters(view: FilterState): boolean {
  return (
    view.search !== "" ||
    view.filter !== "all" ||
    view.readStatus !== null ||
    view.favorites ||
    view.tag !== null ||
    view.collection !== null ||
    view.scope.type !== "all"
  );
}
