import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Trash, Check, AlertTriangle, RefreshCw, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { showToast } from '@/hooks/useToast';
import { useWorkerStatus } from '@/hooks/useWorkerStatus';
import { formatWorkerLastSeen } from '../settingsPanelHelpers';
import { ingestFailureLabel, pathBasename } from '../addPathPanelHelpers';

/**
 * Worker status, in-flight background scans, and persistent ingest errors.
 */
export function JobsAndErrorsSection() {
  // Worker health + in-flight jobs + queue depth (same poll Add-path uses).
  const { data: jobsData, isLoading } = useWorkerStatus();
  const worker = jobsData?.worker;
  const queue = jobsData?.queue;
  const jobs = jobsData?.jobs ?? [];

  // Persistent ingest-error log, refreshed on the same cadence.
  const { data: errorsData, isLoading: errorsLoading, refetch: refetchErrors } = useQuery({
    queryKey: ['ingest-errors'],
    queryFn: () => api.adminGetIngestErrors(200),
    refetchInterval: 15000,
  });
  const [clearingErrors, setClearingErrors] = useState(false);
  const [filterClass, setFilterClass] = useState('all');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const recentErrors = errorsData?.recent ?? [];
  const classes = useMemo(
    () => Array.from(new Set(recentErrors.map((e) => e.errorClass))).sort(),
    [recentErrors],
  );
  const filteredErrors = filterClass === 'all'
    ? recentErrors
    : recentErrors.filter((e) => e.errorClass === filterClass);

  const copyPath = (path: string) => {
    navigator.clipboard?.writeText(path)
      .then(() => {
        setCopiedPath(path);
        setTimeout(() => setCopiedPath(null), 1500);
      })
      .catch(() => {});
  };

  const clearLog = async () => {
    setClearingErrors(true);
    try {
      await api.adminClearIngestErrors();
      await refetchErrors();
      showToast('Ingest error log cleared');
    } catch (err) {
      showToast(errorMessage(err, 'Failed to clear the error log'));
    } finally {
      setClearingErrors(false);
    }
  };

  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Jobs &amp; errors</div>
        {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {worker && (
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', worker.alive ? 'bg-emerald-500' : 'bg-red-500')} />
          <span className="text-sm font-medium text-foreground">{worker.alive ? 'Worker running' : 'Worker stopped'}</span>
          <span className="text-xs text-muted-foreground">
            {worker.alive ? `last seen ${formatWorkerLastSeen(worker.lastSeenAt)}` : 'no recent heartbeat'}
          </span>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-muted-foreground">In-flight jobs</div>
        {jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No scans running.</p>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="flex items-center gap-2 text-xs">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', job.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500')} />
              <span className="truncate text-muted-foreground" title={job.targetPath ?? ''}>
                {job.targetPath ? pathBasename(job.targetPath) : job.kind}
              </span>
              <span className="ml-auto shrink-0 text-muted-foreground">
                {job.status === 'queued' ? 'queued' : `${job.processed}/${job.discovered}`}
              </span>
            </div>
          ))
        )}
        {queue && queue.depth > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {queue.depth} job{queue.depth === 1 ? '' : 's'} in the queue
            {queue.perQueue
              .map((q) => ` · ${q.name}: ${q.queued} queued${q.active > 0 ? `, ${q.active} active` : ''}`)
              .join('')}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-muted-foreground">
            Recent ingest errors
            {errorsData && <span className="text-muted-foreground/70"> ({errorsData.count})</span>}
            {errorsLoading && <RefreshCw className="ml-1 inline h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-muted-foreground hover:text-red-500"
            disabled={clearingErrors || (errorsData?.count ?? 0) === 0}
            onClick={clearLog}
            title="Clear the error log"
          >
            <Trash className="h-3.5 w-3.5" />
          </Button>
        </div>

        {classes.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {['all', ...classes].map((cls) => (
              <button
                key={cls}
                type="button"
                onClick={() => setFilterClass(cls)}
                aria-pressed={filterClass === cls}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                  filterClass === cls
                    ? 'border-primary bg-primary text-primary-foreground font-medium'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {cls === 'all' ? 'All' : ingestFailureLabel(cls)}
              </button>
            ))}
          </div>
        )}

        {filteredErrors.length === 0 ? (
          <p className="text-xs text-muted-foreground">No errors recorded.</p>
        ) : (
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {filteredErrors.map((err, i) => (
              <div key={`${err.ts}-${i}`} className="flex items-start gap-2 rounded-md border border-border bg-card/40 p-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => copyPath(err.path)}
                    title={err.path}
                    className="block w-full truncate text-left text-xs font-medium text-foreground hover:text-primary"
                  >
                    {pathBasename(err.path)}
                  </button>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={err.message}>
                    {ingestFailureLabel(err.errorClass)}
                    {err.message ? ` — ${err.message}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyPath(err.path)}
                  title="Copy path"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  {copiedPath === err.path
                    ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                    : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
