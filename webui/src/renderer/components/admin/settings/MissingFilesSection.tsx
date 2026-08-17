import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Trash, RefreshCw } from 'lucide-react';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { showToast } from '@/hooks/useToast';

/**
 * Missing files — catalog records whose on-disk file the server can no longer
 * see. Lists each missing record (title + stored path) with a per-row Remove,
 * and a "Remove all missing" bulk prune. Self-contained (fetches via
 * `fetchComics` with the missing filter) because only the admin sees it.
 */
export function MissingFilesSection() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['missing-comics'],
    queryFn: () => api.fetchComics({ missing: true, limit: 200 }),
  });
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [pruning, setPruning] = useState(false);

  const records = data?.records ?? [];
  const count = data?.totalCount ?? records.length;

  const remove = async (id: number) => {
    setRemovingId(id);
    try {
      await api.deleteComic(id);
      await refetch();
    } catch (err) {
      showToast(errorMessage(err, 'Failed to remove item'));
    } finally {
      setRemovingId(null);
    }
  };

  const removeAll = async () => {
    setPruning(true);
    try {
      const { removed } = await api.pruneMissing();
      showToast(`Removed ${removed} missing record${removed === 1 ? '' : 's'}`);
      await refetch();
    } catch (err) {
      showToast(errorMessage(err, 'Failed to prune missing records'));
    } finally {
      setPruning(false);
    }
  };

  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Missing files
          {count > 0 && <span className="ml-2 font-normal normal-case text-faint">({count})</span>}
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {count > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] border-border gap-1"
              onClick={() => void removeAll()}
              disabled={pruning}
            >
              {pruning ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash className="h-3 w-3" />}
              Remove all missing
            </Button>
          )}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground leading-normal">
        These records still exist in the library but the file they point to is no longer on disk. Removing one only
        drops the catalog record — the missing file is already gone. Right-click a missing comic and choose
        "Locate…" to repoint it at a moved file instead.
      </p>
      {records.length === 0 ? (
        <p className="text-sm text-muted-foreground">No missing files.</p>
      ) : (
        <div className="space-y-1">
          {records.map((record) => (
            <div
              key={record.id}
              className="flex items-center justify-between gap-2 rounded-md p-1.5 text-xs text-muted-foreground hover:bg-muted/40"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{record.title}</div>
                {record.filePath && (
                  <div className="truncate" title={record.filePath}>
                    {record.filePath}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground hover:text-red-500"
                disabled={removingId === record.id}
                onClick={() => remove(record.id)}
                aria-label={`Remove ${record.title}`}
              >
                <Trash className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
