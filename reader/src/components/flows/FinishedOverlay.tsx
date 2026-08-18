/** End-of-book celebration + "up next". Shown when the reader turns past the
 *  final page (trigger lives in Reader.tsx). Marking finished is implicit —
 *  the server auto-completes on the last page — so this card only offers the
 *  optional follow-ups: favorite the book, jump to the next volume, or go home.
 *  Dismisses on a backdrop tap; the reader guards against re-triggering. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as api from "../../lib/api";
import { coverTreatment } from "../../lib/cover";
import { useSession } from "../../store/session";
import { parseTitle, pickSequel } from "./sequel";
import { ChevronRightIcon, StarIcon } from "../icons";

/** Gather sibling records that might be the next volume, then pick one. Pulls
 *  from title search and, when a series is named exactly, that series' comics —
 *  both are best-effort, so a failure of either just narrows the pool. */
async function findSequel(record: api.WebComicRecord): Promise<api.WebComicRecord | null> {
  const { prefix, volume } = parseTitle(record.title);
  if (volume == null) return null;

  const pool = new Map<number, api.WebComicRecord>();
  const add = (recs: api.WebComicRecord[]) => {
    for (const r of recs) pool.set(r.id, r);
  };

  try {
    const list = await api.listComics({ search: prefix, limit: 50 });
    add(list.records);
  } catch {
    /* ignore — fall back to series lookup / nothing */
  }

  try {
    const series = await api.listSeries();
    const match = series.find((s) => s.name.toLowerCase() === prefix.toLowerCase());
    if (match) add(await api.seriesComics(match.name));
  } catch {
    /* ignore */
  }

  return pickSequel(record, [...pool.values()]);
}

function Cover({ record }: { record: api.WebComicRecord }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const treat = coverTreatment(record.title);
  return (
    <div className="fin-next-cover" style={{ background: treat.gradient }}>
      {!errored && (
        <img
          src={api.coverUrl(record, 240)}
          alt=""
          loading="lazy"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      )}
    </div>
  );
}

export default function FinishedOverlay({
  record,
  guest,
  onDismiss,
  onBackToLibrary,
}: {
  record: api.WebComicRecord;
  guest: boolean;
  onDismiss: () => void;
  onBackToLibrary: () => void;
}) {
  const openBook = useSession((s) => s.openBook);
  const showToast = useSession((s) => s.showToast);
  const [favorited, setFavorited] = useState(record.favorited);
  const [savingFav, setSavingFav] = useState(false);

  const sequelQuery = useQuery({
    queryKey: ["sequel", record.id],
    queryFn: () => findSequel(record),
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  const sequel = sequelQuery.data ?? null;

  const toggleFavorite = async () => {
    if (guest || savingFav) return;
    const next = !favorited;
    setFavorited(next); // optimistic
    setSavingFav(true);
    try {
      await api.setFavorite(record, next);
    } catch {
      setFavorited(!next); // revert
      showToast("Couldn’t update favorite.");
    } finally {
      setSavingFav(false);
    }
  };

  return (
    <div className="fin-backdrop" onClick={onDismiss}>
      <div
        className="fin-card"
        role="dialog"
        aria-label="Finished reading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fin-eyebrow">Finished</div>
        <div className="fin-title serif">{record.title}</div>

        {!guest && (
          <button
            className={`fin-fav${favorited ? " on" : ""}`}
            onClick={toggleFavorite}
            disabled={savingFav}
            aria-pressed={favorited}
          >
            <span className="fin-star" aria-hidden="true">
              <StarIcon size={16} filled={favorited} />
            </span>
            {favorited ? "Favorited" : "Add to favorites"}
          </button>
        )}

        {sequel && (
          <button
            className="fin-next"
            onClick={() => openBook(sequel)}
            aria-label={`Up next: ${sequel.title}`}
          >
            <Cover record={sequel} />
            <span className="fin-next-texts">
              <span className="fin-next-eyebrow">Up next</span>
              <span className="fin-next-title">{sequel.title}</span>
            </span>
            <span className="fin-next-go" aria-hidden="true">
              <ChevronRightIcon size={20} />
            </span>
          </button>
        )}

        <button className="fin-home" onClick={onBackToLibrary}>
          Back to library
        </button>
      </div>
    </div>
  );
}
