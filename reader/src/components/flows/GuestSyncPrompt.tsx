/** Offered right after a guest signs in, while positions read during guest
 *  browsing are still stashed locally (see lib/guestProgress.ts). Uploading
 *  them one-by-one via the now-authenticated session lets the reader pick up on
 *  every device where they left off. Rendered by Connect *before* it enters the
 *  library, so the session is authenticated (writes PUT for real) but the
 *  connect screen is still mounted to host this card. */
import { useMemo, useState } from "react";
import * as api from "../../lib/api";
import { allGuestProgress, clearGuestProgress } from "../../lib/guestProgress";
import { useSession } from "../../store/session";

export default function GuestSyncPrompt({
  serverUrl,
  onFinish,
}: {
  serverUrl: string;
  /** Called once the stash is synced or discarded — Connect enters the library. */
  onFinish: () => void;
}) {
  const showToast = useSession((s) => s.showToast);
  const [busy, setBusy] = useState(false);

  // Snapshot the stash on mount so the count stays stable as we clear it.
  const entries = useMemo(() => Object.entries(allGuestProgress(serverUrl)), [serverUrl]);
  const count = entries.length;

  const sync = async () => {
    if (busy) return;
    setBusy(true);
    let ok = 0;
    for (const [id, gp] of entries) {
      const body: api.ProgressBody = {};
      if (gp.page !== undefined) body.page = gp.page;
      if (gp.location !== undefined) body.location = gp.location;
      if (gp.percent !== undefined) body.percent = gp.percent;
      try {
        await api.putServerProgress(Number(id), body);
        ok++;
      } catch {
        /* skip a book that no longer exists / rejects; keep going */
      }
    }
    clearGuestProgress(serverUrl);
    showToast(`Synced ${ok} position${ok === 1 ? "" : "s"}`);
    onFinish();
  };

  const discard = () => {
    if (busy) return;
    clearGuestProgress(serverUrl);
    onFinish();
  };

  return (
    <div className="fin-backdrop sync-backdrop">
      <div className="fin-card" role="dialog" aria-label="Sync reading positions">
        <div className="fin-eyebrow">Welcome back</div>
        <div className="fin-title serif">Sync your reading?</div>
        <div className="sync-body">
          You have {count} reading position{count === 1 ? "" : "s"} from guest
          browsing. Sync {count === 1 ? "it" : "them"} to your account?
        </div>
        <button className="btn-accent" onClick={sync} disabled={busy}>
          {busy ? "Syncing…" : `Sync ${count === 1 ? "position" : "positions"}`}
        </button>
        <button className="fin-home" onClick={discard} disabled={busy}>
          Discard
        </button>
      </div>
    </div>
  );
}
