import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Trash, RefreshCw, Hash } from 'lucide-react';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { showToast } from '@/hooks/useToast';

/**
 * Duplicate review — lists exact content-hash copies and likely same
 * series/volume lookalikes, with a per-record Remove action. Self-contained
 * (fetches via `fetchDuplicates`) because only the admin sees it.
 */
export function DuplicatesSection() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['duplicates'],
    queryFn: api.fetchDuplicates,
  });
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [hashing, setHashing] = useState(false);

  /** One-shot content-hash backfill (P1-4): hash legacy rows, then re-scan. */
  const hashExisting = async () => {
    setHashing(true);
    try {
      const { hashed, remaining } = await api.hashBackfill();
      showToast(
        hashed > 0
          ? `Hashed ${hashed} file${hashed === 1 ? '' : 's'} — ${remaining} still pending`
          : remaining > 0
            ? `No files hashed — ${remaining} still pending (click again to continue)`
            : 'All files already hashed',
      );
      await refetch();
    } catch (err) {
      showToast(errorMessage(err, 'Hash backfill failed'));
    } finally {
      setHashing(false);
    }
  };

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

  const groups = data?.groups ?? [];
  const exact = groups.filter((g) => g.kind === 'exact');
  const likely = groups.filter((g) => g.kind === 'likely');

  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Duplicates</div>
        <div className="flex items-center gap-2">
          {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px] border-border gap-1"
            onClick={() => void hashExisting()}
            disabled={hashing}
          >
            {hashing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Hash className="h-3 w-3" />}
            Hash existing files
          </Button>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground leading-normal">
        Exact copies share identical file bytes (same archive stored twice); likely duplicates share the same series and
        volume from different sources. Removing one only drops the catalog record — files on disk are never touched.
        Files added before hashing shipped carry no hash yet — "Hash existing files" backfills them so exact copies surface here.
      </p>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No duplicates found.</p>
      ) : (
        <div className="space-y-3">
          {exact.length > 0 && (
            <DuplicateGroupList label="Exact copies" groups={exact} removingId={removingId} onRemove={remove} />
          )}
          {likely.length > 0 && (
            <DuplicateGroupList label="Likely duplicates" groups={likely} removingId={removingId} onRemove={remove} />
          )}
        </div>
      )}
    </div>
  );
}

function DuplicateGroupList({
  label,
  groups,
  removingId,
  onRemove,
}: {
  label: string;
  groups: api.DuplicateGroup[];
  removingId: number | null;
  onRemove: (id: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      {groups.map((group) => (
        <div key={`${group.kind}:${group.key}`} className="border border-border rounded-md p-2 space-y-1">
          <div className="text-xs font-medium text-foreground">{group.title}</div>
          {group.members.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate" title={member.filePath}>
                {member.filePath}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground hover:text-red-500"
                disabled={removingId === member.id}
                onClick={() => onRemove(member.id)}
              >
                <Trash className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
