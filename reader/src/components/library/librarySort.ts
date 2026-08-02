/** Persisted library sort choice. Only the three orderings the design surfaces
 *  (Title / Recently read / Date added) are offered; each maps to a CB8
 *  `sortBy` + `sortOrder`. Default: Title, ascending. */
import { useCallback, useState } from "react";
import type { SortBy, SortOrder } from "../../lib/api";

export interface SortChoice {
  sortBy: Extract<SortBy, "title" | "lastRead" | "dateAdded">;
  sortOrder: SortOrder;
}

export interface SortOption {
  sortBy: SortChoice["sortBy"];
  label: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { sortBy: "title", label: "Title" },
  { sortBy: "lastRead", label: "Recently read" },
  { sortBy: "dateAdded", label: "Date added" },
];

const KEY = "shelf.librarySort";
const DEFAULT: SortChoice = { sortBy: "title", sortOrder: "asc" };

function read(): SortChoice {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<SortChoice>;
    const sortBy = SORT_OPTIONS.some((o) => o.sortBy === parsed.sortBy)
      ? (parsed.sortBy as SortChoice["sortBy"])
      : DEFAULT.sortBy;
    const sortOrder: SortOrder = parsed.sortOrder === "desc" ? "desc" : "asc";
    return { sortBy, sortOrder };
  } catch {
    return DEFAULT;
  }
}

export function labelFor(choice: SortChoice): string {
  const opt = SORT_OPTIONS.find((o) => o.sortBy === choice.sortBy);
  return opt?.label ?? "Title";
}

export function useLibrarySort() {
  const [sort, setSort] = useState<SortChoice>(read);

  const update = useCallback((next: SortChoice) => {
    setSort(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — keep it in memory only */
    }
  }, []);

  const setSortBy = useCallback(
    (sortBy: SortChoice["sortBy"]) => update({ sortBy, sortOrder: sort.sortOrder }),
    [sort.sortOrder, update],
  );
  const toggleOrder = useCallback(
    () => update({ sortBy: sort.sortBy, sortOrder: sort.sortOrder === "asc" ? "desc" : "asc" }),
    [sort.sortBy, sort.sortOrder, update],
  );

  return { sort, setSort: update, setSortBy, toggleOrder };
}
