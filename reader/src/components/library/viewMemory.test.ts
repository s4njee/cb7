/** Vector module (see `lib/vectorSuite.test.ts`): pure assertions over the
 *  library's session view memory and its "is anything narrowing the shelf"
 *  predicate. No DOM, no React — the memory is a plain module. */
import {
  forgetLibraryView,
  hasActiveFilters,
  recallLibraryView,
  rememberLibraryView,
  type FilterState,
  type LibraryView,
} from "./viewMemory";

export interface ViewMemoryVector {
  name: string;
  run: () => void;
}

const REMEMBERED: LibraryView = {
  shelf: "server",
  serverUrl: "http://shelf.local:4218",
  scope: { type: "series", name: "Saga" },
  search: "keeper",
  filter: "book",
  readStatus: "unread",
  favorites: true,
  tag: null,
  collection: null,
  scrollTop: 640,
};

const NOTHING_ACTIVE: FilterState = {
  search: "",
  filter: "all",
  readStatus: null,
  favorites: false,
  tag: null,
  collection: null,
  scope: { type: "all" },
};

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export const VIEW_MEMORY_VECTORS: ViewMemoryVector[] = [
  {
    name: "a fresh process opens on a clean shelf",
    run: () => {
      forgetLibraryView();
      assert(recallLibraryView(null) === null, "expected no remembered view");
    },
  },
  {
    name: "returning from a book lands exactly where you left",
    run: () => {
      forgetLibraryView();
      rememberLibraryView(REMEMBERED);
      const recalled = recallLibraryView(REMEMBERED.serverUrl);
      assert(recalled !== null, "expected a remembered view");
      assert(
        JSON.stringify(recalled) === JSON.stringify(REMEMBERED),
        `round-trip changed the view: ${JSON.stringify(recalled)}`,
      );
    },
  },
  {
    name: "signing out forgets the scope, which belonged to that server",
    run: () => {
      rememberLibraryView(REMEMBERED);
      forgetLibraryView();
      assert(recallLibraryView(REMEMBERED.serverUrl) === null, "expected the view to be forgotten");
    },
  },
  {
    name: "a server view is not restored onto a different server",
    run: () => {
      forgetLibraryView();
      rememberLibraryView(REMEMBERED);
      assert(
        recallLibraryView("http://other.local:4218") === null,
        "expected another server's view to be dropped",
      );
      // The on-device shelf travels: it is the same shelf wherever you point.
      rememberLibraryView({ ...REMEMBERED, shelf: "local" });
      assert(
        recallLibraryView("http://other.local:4218") !== null,
        "expected the on-device view to survive a server change",
      );
    },
  },
  {
    name: "an untouched shelf has no active filters",
    run: () => {
      assert(!hasActiveFilters(NOTHING_ACTIVE), "expected no active filters");
    },
  },
  {
    name: "every narrowing counts, including the scope itself",
    run: () => {
      const narrowings: Array<Partial<FilterState>> = [
        { search: "keeper" },
        { filter: "comic" },
        { readStatus: "completed" },
        { favorites: true },
        { tag: "noir" },
        { collection: "To read" },
        { scope: { type: "series", name: "Saga" } },
      ];
      for (const narrowing of narrowings) {
        assert(
          hasActiveFilters({ ...NOTHING_ACTIVE, ...narrowing }),
          `expected active for ${JSON.stringify(narrowing)}`,
        );
      }
    },
  },
];

export function runViewMemoryVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of VIEW_MEMORY_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `viewMemory: ${VIEW_MEMORY_VECTORS.length} ok`
      : `viewMemory: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
