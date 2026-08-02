/** Reading statistics + server history, as a full-screen sheet layered over the
 *  library (rendered by App when session.sheet === 'stats'). Stats are derived
 *  entirely from the on-device log (lib/stats.ts); History is the server's
 *  open/close breadcrumb feed, signed-in only. */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../../lib/api";
import { toApiError } from "../../lib/transport";
import {
  currentStreak,
  formatDuration,
  readStats,
  topBooks,
  totals,
  weekBars,
} from "../../lib/stats";
import { useSession } from "../../store/session";

type Tab = "stats" | "history";
const PAGE = 50;

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w} w ago`;
  return new Date(then).toLocaleDateString();
}

function StatsTab({ serverUrl }: { serverUrl: string }) {
  const view = useMemo(() => {
    const data = readStats(serverUrl);
    return {
      bars: weekBars(data),
      totals: totals(data),
      streak: currentStreak(data),
      top: topBooks(data),
    };
  }, [serverUrl]);

  const maxMin = Math.max(1, ...view.bars.map((b) => b.minutes));
  const hasAny = view.totals.weekMs > 0 || view.top.length > 0;

  return (
    <div className="stats-tab">
      <section className="stats-block">
        <div className="stats-block-label">This week</div>
        <div className="stats-bars">
          {view.bars.map((b) => (
            <div className="stats-bar-col" key={b.key} title={`${b.minutes} min`}>
              <div className="stats-bar-track">
                <div
                  className={`stats-bar-fill${b.isToday ? " today" : ""}`}
                  style={{ height: `${Math.round((b.minutes / maxMin) * 100)}%` }}
                />
              </div>
              <div className={`stats-bar-day${b.isToday ? " today" : ""}`}>
                {b.label.slice(0, 1)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stats-totals">
        <div className="stats-stat">
          <div className="stats-stat-num">{formatDuration(view.totals.todayMs)}</div>
          <div className="stats-stat-cap">Today</div>
        </div>
        <div className="stats-stat">
          <div className="stats-stat-num">{formatDuration(view.totals.weekMs)}</div>
          <div className="stats-stat-cap">This week</div>
        </div>
        <div className="stats-stat">
          <div className="stats-stat-num">{view.totals.weekPages}</div>
          <div className="stats-stat-cap">Pages this week</div>
        </div>
        <div className="stats-stat">
          <div className="stats-stat-num">
            {view.streak}
            <span className="stats-stat-unit">
              {view.streak === 1 ? " day" : " days"}
            </span>
          </div>
          <div className="stats-stat-cap">Current streak</div>
        </div>
      </section>

      {view.top.length > 0 && (
        <section className="stats-block">
          <div className="stats-block-label">Top this week</div>
          <div className="stats-top">
            {view.top.map((b) => (
              <div className="stats-top-row" key={b.comicId}>
                <span className="stats-top-title">{b.title}</span>
                <span className="stats-top-time">{formatDuration(b.ms)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!hasAny && (
        <div className="stats-empty">
          No reading tracked yet.
          <br />
          Open a book — your time and pages will show up here.
        </div>
      )}
    </div>
  );
}

function HistoryTab({ guest }: { guest: boolean }) {
  const [entries, setEntries] = useState<api.HistoryEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (off: number) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.getHistory(off, PAGE);
      setEntries((prev) => (off === 0 ? resp.entries : [...prev, ...resp.entries]));
      setTotal(resp.totalCount);
      setOffset(off + resp.entries.length);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (guest) return;
    void loadPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest]);

  if (guest) {
    return (
      <div className="stats-empty">Sign in to see your server history.</div>
    );
  }

  const hasMore = total != null && entries.length < total;

  return (
    <div className="hist-tab">
      {error && <div className="stats-empty">{error}</div>}
      {!error && entries.length === 0 && !loading && (
        <div className="stats-empty">No reading history yet.</div>
      )}
      <div className="hist-list">
        {entries.map((e) => (
          <div className="hist-row" key={e.id}>
            <span className="hist-texts">
              <span className="hist-title">{e.comicTitle}</span>
              <span className="hist-sub">
                {e.action === "opened" ? "Opened" : "Closed"}
                {e.page != null ? ` · page ${e.page + 1}` : ""}
                {` · ${relTime(e.timestamp)}`}
              </span>
            </span>
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          className="hist-more"
          onClick={() => loadPage(offset)}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
      {loading && entries.length === 0 && (
        <div className="stats-empty">Loading…</div>
      )}
    </div>
  );
}

export default function StatsSheet() {
  const closeSheet = useSession((s) => s.closeSheet);
  const serverUrl = useSession((s) => s.serverUrl);
  const guest = useSession((s) => s.guest);
  const [tab, setTab] = useState<Tab>("stats");

  return (
    <div className="sheet">
      <div className="sheet-head">
        <div className="drawer-title">Reading</div>
        <button className="close-btn" onClick={closeSheet} aria-label="Close">
          ×
        </button>
      </div>

      <div className="sheet-seg">
        <div className="segmented">
          <button
            className={`seg-btn small${tab === "stats" ? " active" : ""}`}
            onClick={() => setTab("stats")}
          >
            Stats
          </button>
          <button
            className={`seg-btn small${tab === "history" ? " active" : ""}`}
            onClick={() => setTab("history")}
          >
            History
          </button>
        </div>
      </div>

      <div className="sheet-body">
        {tab === "stats" ? (
          <StatsTab serverUrl={serverUrl ?? ""} />
        ) : (
          <HistoryTab guest={guest} />
        )}
      </div>
    </div>
  );
}
