/** In-book text search drawer — Cmd/Ctrl+F while reading. Lists per-section
 *  hits from the active reader and jumps through the shell's back-stack. */
import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "./readerTypes";

export default function SearchDrawer({
  bookTitle,
  search,
  onGo,
  onClose,
}: {
  bookTitle: string;
  /** Runs the active reader's in-book search (comics return []). */
  search: (query: string) => Promise<SearchHit[]>;
  onGo: (target: string | number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounce = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (debounce.current != null) window.clearTimeout(debounce.current);
    };
  }, [onClose]);

  // Debounced search so every keystroke doesn't walk the whole book.
  useEffect(() => {
    if (debounce.current != null) window.clearTimeout(debounce.current);
    const q = query.trim();
    if (!q) {
      setHits([]);
      setDone(false);
      return;
    }
    setRunning(true);
    debounce.current = window.setTimeout(() => {
      void search(q)
        .then((h) => {
          setHits(h);
          setDone(true);
        })
        .catch(() => {
          setHits([]);
          setDone(true);
        })
        .finally(() => setRunning(false));
    }, 250);
  }, [query, search]);

  return (
    <>
      <div className="drawer-head">
        <div className="drawer-title">Search “{bookTitle}”</div>
        <button className="close-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <input
        ref={inputRef}
        className="search-input drawer-search"
        placeholder="Find in this book…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
        autoCapitalize="none"
      />

      <div className="drawer-scroll search-results">
        {!query.trim() && <div className="search-hint">Type to search inside the book.</div>}
        {running && <div className="search-hint">Searching…</div>}
        {done && !running && hits.length === 0 && (
          <div className="search-hint">No matches.</div>
        )}
        {hits.map((h, i) => (
          <button
            key={`${h.target}-${i}`}
            type="button"
            className="search-hit"
            onClick={() => onGo(h.target)}
          >
            <div className="search-hit-label">
              {h.label}
              {h.count > 1 && <span className="search-hit-count">{h.count}</span>}
            </div>
            <div className="search-hit-snippet">{h.snippet}</div>
          </button>
        ))}
      </div>
    </>
  );
}
