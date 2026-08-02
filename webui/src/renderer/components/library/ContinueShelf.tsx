import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import { comicCaption, progressPercentFor, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import TypographicCover from './TypographicCover';

const SHELF_LIMIT = 20;

function thumbnailSrc(record: api.WebComicRecord) {
  return `/api/comics/${record.id}/thumbnail?v=${encodeURIComponent(record.dateAdded)}`;
}

/** Shelf cover with a typographic fallback when the thumbnail is missing. */
function ShelfCover({ record, className }: { record: api.WebComicRecord; className?: string }) {
  const [err, setErr] = useState(false);
  return (
    <div className={cn('overflow-hidden bg-secondary shrink-0', className)}>
      {err ? (
        <TypographicCover title={record.title} />
      ) : (
        <img
          src={thumbnailSrc(record)}
          alt={record.title}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setErr(true)}
        />
      )}
    </div>
  );
}

export default function ContinueShelf() {
  const navigate = useNavigate();
  const { mediaType } = useUiStore();

  // Query for continue reading items
  const { data: records = [], isLoading } = useQuery<api.WebComicRecord[]>({
    queryKey: ['continue-reading', mediaType],
    queryFn: () => api.fetchContinueReading(SHELF_LIMIT, mediaType || undefined),
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

  // Most recent item gets the hero card; the rest queue up beneath it.
  const [hero, ...upNext] = records;

  return (
    <section className="px-4 md:px-10 pt-6 pb-4 select-none">
      {/* Section label */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-section">
          Continue reading
        </h2>
        <Link to="/continue" className="text-xs text-faint hover:text-foreground">
          See all
        </Link>
      </div>

      {/* Hero card for the most recent in-progress item */}
      <div
        onClick={() => navigate(`/read/${hero.id}`)}
        onContextMenu={(e) => e.preventDefault()}
        className="max-w-[640px] flex items-center gap-6 bg-hero border border-[hsl(var(--header-rule))] rounded-xl px-6 py-5 cursor-pointer transition-colors hover:border-popover-border"
        data-id={hero.id}
      >
        <ShelfCover record={hero} className="w-[78px] h-[114px] rounded" />
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <h3 className="font-serif text-[22px] line-clamp-2 text-foreground leading-tight">
            {hero.title}
          </h3>
          <div className="flex items-center gap-3 mt-1">
            <div className="h-[3px] flex-1 rounded-full bg-progress-track overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: `${progressPercentFor(hero)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {progressPercentFor(hero)}% · {comicCaption(hero)}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/read/${hero.id}`);
          }}
          className="shrink-0 border-primary text-primary bg-transparent hover:bg-primary/10 hover:text-primary rounded-lg h-9 px-5"
        >
          Resume
        </Button>
      </div>

      {/* Compact "up next" row for the remaining in-progress items */}
      {upNext.length > 0 && (
        <ScrollArea className="w-full whitespace-nowrap mt-3">
          <div className="flex gap-2 pb-3">
            {upNext.map((comic) => (
              <button
                key={comic.id}
                onClick={() => navigate(`/read/${comic.id}`)}
                onContextMenu={(e) => e.preventDefault()}
                className="flex items-center gap-2 w-[180px] shrink-0 text-left bg-card border border-border rounded-lg px-2 py-1.5 hover:border-primary/50 transition-colors"
                data-id={comic.id}
              >
                <ShelfCover record={comic} className="w-9 aspect-[2/3] rounded" />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className="text-xs font-medium truncate text-foreground">
                    {comic.title}
                  </span>
                  <div className="h-[3px] w-full rounded-full bg-progress-track overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${progressPercentFor(comic)}%` }}
                    />
                  </div>
                </div>
              </button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="bg-border/20" />
        </ScrollArea>
      )}
    </section>
  );
}
