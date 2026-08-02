/** Read-status + favorites chips. Signed-in only (per-user data). The three
 *  status chips are mutually exclusive — tapping the active one clears it. The
 *  favorites chip is an independent toggle rendered alongside. */
import type { ReadStatus } from "../../lib/api";

const STATUS: { value: ReadStatus; label: string }[] = [
  { value: "unread", label: "Unread" },
  { value: "in-progress", label: "Reading" },
  { value: "completed", label: "Finished" },
];

export default function StatusChips({
  readStatus,
  onReadStatus,
  favorites,
  onFavorites,
}: {
  readStatus: ReadStatus | null;
  onReadStatus: (status: ReadStatus | null) => void;
  favorites: boolean;
  onFavorites: (on: boolean) => void;
}) {
  return (
    <div className="status-chips">
      {STATUS.map((s) => {
        const active = readStatus === s.value;
        return (
          <button
            key={s.value}
            className={`chip${active ? " active" : ""}`}
            aria-pressed={active}
            onClick={() => onReadStatus(active ? null : s.value)}
          >
            {s.label}
          </button>
        );
      })}
      <button
        className={`chip chip-fav${favorites ? " active" : ""}`}
        aria-pressed={favorites}
        onClick={() => onFavorites(!favorites)}
      >
        <span className="chip-heart" aria-hidden="true">
          {favorites ? "♥" : "♡"}
        </span>
        Favorites
      </button>
    </div>
  );
}
