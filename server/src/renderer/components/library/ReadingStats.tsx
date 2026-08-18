import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Flame, UserRound } from 'lucide-react';
import * as api from '@/lib/api';

/**
 * Compact per-user reading summary (P1-7): pages this week, the current
 * streak, and the top author. Hidden entirely for guests (the stats endpoint
 * 401s) and when the user has no activity yet. Pure presentation — data comes
 * from `GET /api/stats`.
 */
export default function ReadingStats() {
  const { data: session } = useQuery({ queryKey: ['session'], queryFn: api.getSession });
  const isUser = Boolean(session?.user);

  const { data, isError, isLoading } = useQuery({
    queryKey: ['reading-stats'],
    queryFn: api.fetchReadingStats,
    enabled: isUser,
    retry: false,
  });

  // Guests 401 (isError); a freshly-created account with no reading returns
  // all zeros — nothing worth a strip. Either way, render nothing.
  if (!isUser || isError || isLoading || !data) return null;
  const hasActivity = data.pages.week > 0 || data.streak > 0 || data.topAuthors.length > 0;
  if (!hasActivity) return null;

  const topAuthor = data.topAuthors[0];

  return (
    <div className="px-4 md:px-10 pt-4 select-none">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-secondary/20 px-4 py-2.5 text-xs">
        <span className="flex items-center gap-1.5 font-semibold text-muted-foreground uppercase tracking-wider">
          <BookOpen className="h-3.5 w-3.5 text-primary" />
          Reading
        </span>
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">{data.pages.week}</span> page
          {data.pages.week === 1 ? '' : 's'} this week
        </span>
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">{data.sessions.week}</span> session
          {data.sessions.week === 1 ? '' : 's'}
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Flame className={`h-3.5 w-3.5 ${data.streak >= 2 ? 'text-orange-500' : ''}`} />
          <span className="font-medium text-foreground">{data.streak}</span>-day streak
        </span>
        {topAuthor && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" />
            Top author: <span className="font-medium text-foreground">{topAuthor.name}</span>
          </span>
        )}
      </div>
    </div>
  );
}
