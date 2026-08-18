/** Browse one saved OPDS catalog: folders, publications, search, download. */
import { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import { toApiError } from "../../lib/transport";
import { coverTreatment } from "../../lib/cover";
import { useDeviceTransfer } from "../../lib/deviceTransfer";
import { useSession } from "../../store/session";
import { BackIcon, ChevronRightIcon, CloseIcon } from "../icons";
import "../../styles/library.css";
import "../../styles/opds.css";

let nextProgressId = -1;

function allocProgressId(): number {
  return nextProgressId--;
}

interface Crumb {
  title: string;
  href: string | null;
}

export default function OpdsBrowser({
  catalog,
  onClose,
  onBack,
  onImported,
}: {
  catalog: api.OpdsCatalog;
  onClose: () => void;
  /** Leave the feed and return to the catalog list. */
  onBack: () => void;
  onImported: () => void;
}) {
  const showToast = useSession((s) => s.showToast);
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ title: catalog.name, href: null }]);
  const [feed, setFeed] = useState<api.OpdsFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [getting, setGetting] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (href: string | null, title?: string, replace = false) => {
      setBusy(true);
      setError(null);
      try {
        const next = await api.opdsBrowse(catalog.id, href);
        setFeed(next);
        if (replace) {
          setCrumbs([{ title: title || next.title || catalog.name, href }]);
        } else if (title) {
          setCrumbs((prev) => [...prev, { title, href }]);
        }
      } catch (err) {
        setError(toApiError(err).message);
      } finally {
        setBusy(false);
      }
    },
    [catalog.id, catalog.name],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openNav = (entry: api.OpdsNavEntry) => {
    void load(entry.href, entry.title);
  };

  const goCrumb = (index: number) => {
    const crumb = crumbs[index];
    setCrumbs(crumbs.slice(0, index + 1));
    void load(crumb.href);
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || !feed?.searchTemplate) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.opdsSearch(catalog.id, q, feed.searchTemplate);
      setFeed(next);
      setCrumbs((prev) => [...prev, { title: `“${q}”`, href: next.href }]);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const loadMore = async () => {
    if (!feed?.nextHref) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.opdsBrowse(catalog.id, feed.nextHref);
      setFeed({
        ...next,
        navigation: feed.navigation,
        publications: [...feed.publications, ...next.publications],
      });
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const getBook = async (pub: api.OpdsPublication) => {
    const acq = pub.acquisitions[0];
    if (!acq) return;
    if (getting.has(acq.href)) return;
    setGetting((prev) => new Set(prev).add(acq.href));
    const progressId = allocProgressId();
    useDeviceTransfer.getState().start(progressId, pub.title);
    try {
      const result = await api.opdsDownload({
        catalogId: catalog.id,
        href: acq.href,
        title: pub.title,
        mime: acq.mime,
        coverHref: pub.coverHref,
        progressId,
      });
      onImported();
      showToast(result.alreadyOwned ? `“${pub.title}” is already on your shelf` : `Saved “${pub.title}” to your shelf`);
    } catch (err) {
      const msg = toApiError(err).message;
      useDeviceTransfer.getState().fail(progressId, msg);
      showToast(msg);
    } finally {
      setGetting((prev) => {
        const next = new Set(prev);
        next.delete(acq.href);
        return next;
      });
    }
  };

  const formatLabel = (acq: api.OpdsAcquisition) => (acq.ext || "file").toUpperCase();

  return (
    <div className="panel opds-browser">
      <div className="panel-header">
        <button type="button" className="opds-back" onClick={onBack}>
          <BackIcon size={18} />
          <span>Catalogs</span>
        </button>
        <div className="panel-title">{catalog.name}</div>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={17} />
        </button>
      </div>

      {crumbs.length > 1 && (
        <div className="opds-crumbs">
          {crumbs.map((c, i) => (
            <span key={`${c.href ?? "root"}-${i}`}>
              {i > 0 && <span className="opds-crumb-sep">/</span>}
              {i === crumbs.length - 1 ? (
                <span className="opds-crumb-here">{c.title}</span>
              ) : (
                <button type="button" className="opds-crumb" onClick={() => goCrumb(i)}>
                  {c.title}
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {feed?.searchTemplate && (
        <form className="opds-search" onSubmit={search}>
          <input
            className="pill-input"
            type="search"
            placeholder="Search this catalog"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button className="btn-ghost" type="submit" disabled={busy || !query.trim()}>
            Search
          </button>
        </form>
      )}

      {error && <div className="error-text">{error}</div>}
      {busy && !feed && <div className="panel-empty">Opening catalog…</div>}

      {feed && (
        <>
          {feed.navigation.length === 0 && feed.publications.length === 0 && !busy && (
            <div className="panel-empty">Nothing in this section.</div>
          )}

          {feed.navigation.length > 0 && (
            <div className="opds-nav">
              {feed.navigation.map((entry) => (
                <button
                  key={entry.href}
                  type="button"
                  className="opds-nav-row"
                  onClick={() => openNav(entry)}
                  disabled={busy}
                >
                  <span className="opds-nav-title">{entry.title}</span>
                  <ChevronRightIcon size={18} className="opds-nav-chevron" />
                </button>
              ))}
            </div>
          )}

          {feed.publications.length > 0 && (
            <div className="opds-pubs">
              {feed.publications.map((pub) => {
                const treat = coverTreatment(pub.title);
                const acq = pub.acquisitions[0];
                const inFlight = acq ? getting.has(acq.href) : false;
                return (
                  <div key={pub.identifier || acq?.href || pub.title} className="opds-pub">
                    <div className="opds-pub-cover" style={{ background: treat.gradient, color: treat.ink }}>
                      {pub.title.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="opds-pub-body">
                      <div className="opds-pub-title">{pub.title}</div>
                      {pub.authors.length > 0 && (
                        <div className="opds-pub-authors">{pub.authors.join(", ")}</div>
                      )}
                      {pub.summary && <div className="opds-pub-summary">{pub.summary}</div>}
                    </div>
                    {acq ? (
                      <button
                        type="button"
                        className="btn-accent opds-get"
                        onClick={() => void getBook(pub)}
                        disabled={inFlight}
                      >
                        {inFlight ? "Saving…" : `Get ${formatLabel(acq)}`}
                      </button>
                    ) : (
                      <span className="opds-no-file">No file</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {feed.nextHref && (
            <button type="button" className="btn-ghost" onClick={() => void loadMore()} disabled={busy}>
              {busy ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
