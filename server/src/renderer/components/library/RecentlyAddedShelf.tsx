import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import { Loader2 } from 'lucide-react';
import TypographicCover from './TypographicCover';

const SHELF_LIMIT = 20;

/** Small shelf cover with a typographic fallback when the thumbnail is missing. */
function Cover({ record }: { record: api.WebComicRecord }) {
  const [err, setErr] = useState(false);
  return (
    <div className="w-full aspect-[2/3] overflow-hidden rounded-md bg-secondary">
      {err ? (
        <TypographicCover title={record.title} mediaType={record.mediaType} />
      ) : (
        <img
          src={`/api/comics/${record.id}/thumbnail?v=${encodeURIComponent(record.dateAdded)}`}
          alt={record.title}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setErr(true)}
        />
      )}
    </div>
  );
}

/**
 * Recently added shelf (P3-2): the newest catalog entries ("new on disk"),
 * distinct from Continue reading ("I just read this"). Compact horizontal row.
 */
export default function RecentlyAddedShelf() {
  const navigate = useNavigate();
  const { mediaType, density } = useUiStore();

  const { data: records = [], isLoading } = useQuery<api.WebComicRecord[]>({
    queryKey: ['recently-added', mediaType],
    queryFn: () => api.fetchRecentlyAdded(SHELF_LIMIT, mediaType || undefined),
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 h-24 text-muted-foreground text-xs select-none">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span>Loading shelf...</span>
      </div>
    );
  }

  if (records.length === 0) return null;

  return (
    <section className="recently-added-shelf px-4 md:px-10 pt-6 pb-4 select-none">
      <div className="flex items-center justify-between mb-3">
        <h2 className="eyebrow">
          Recently added
        </h2>
        <span className="text-xs text-faint">Newest on disk</span>
      </div>
      <div className={`recently-added-grid${density === 'compact' ? ' is-compact' : ''}`}>
          {records.map((comic) => (
            <button
              key={comic.id}
              onClick={() => navigate(`/read/${comic.id}`)}
              className="recently-added-card text-left group"
              aria-label={comic.title}
            >
              <Cover record={comic} />
              <span className="mt-1.5 block text-xs leading-tight line-clamp-2 text-foreground/90 group-hover:text-foreground">
                {comic.title}
              </span>
            </button>
          ))}
      </div>
    </section>
  );
}
