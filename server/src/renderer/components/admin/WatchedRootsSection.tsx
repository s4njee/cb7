import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, RefreshCw } from 'lucide-react';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { showToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import AddPathPanel from './AddPathPanel';
import {
  AUTO_RESCAN_PRESETS,
  autoRescanSavedMessage,
  parseAutoRescanMinutes,
} from './settingsPanelHelpers';

/**
 * @module
 * Watched library roots (drop-folder ingest) admin surface.
 *
 * Lists every folder with a registered `scan_path`, shows its scan status, and
 * exposes the per-root actions (Rescan, enable/disable auto-scan, edit path,
 * remove watch) plus the interval control. "Add watched folder" reuses
 * `AddPathPanel` — add-path with a folder name registers the root.
 *
 * Self-fetching (like `WorkerStatusSection`) — it is the only consumer of
 * `fetchWatchedRoots`, so lifting the query to the parent adds noise.
 */

const ROOTS_QUERY_KEY = ['watched-roots'] as const;
const INTERVAL_QUERY_KEY = ['auto-rescan-interval'] as const;

function formatLastScan(ts: number | null): string {
  if (ts == null) return 'Never';
  return new Date(ts).toLocaleString();
}

type RootJob = NonNullable<api.WatchedRoot['lastScanJob']>;

/** Human status for a root's newest scan job, for the Status column. */
function statusLine(job: RootJob): { text: string; tone: 'running' | 'error' | 'ok' } {
  if (job.status === 'queued') return { text: 'Queued — waiting for the worker', tone: 'running' };
  if (job.status === 'active') return { text: 'Scanning…', tone: 'running' };
  if (job.status === 'failed') {
    return { text: job.error ? `Last scan failed: ${job.error}` : 'Last scan failed', tone: 'error' };
  }
  return {
    text: job.added > 0 ? `Last scan added ${job.added} item${job.added === 1 ? '' : 's'}` : 'Last scan added nothing new',
    tone: 'ok',
  };
}

interface RootRowProps {
  root: api.WatchedRoot;
  busy: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onRescan: () => void;
  onEditPath: () => void;
  onRemove: () => void;
}

function RootRow({ root, busy, onToggleEnabled, onRescan, onEditPath, onRemove }: RootRowProps) {
  const status = root.lastScanJob ? statusLine(root.lastScanJob) : null;
  return (
    <li className="border border-border rounded-lg p-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{root.name}</div>
          <div className="text-[11px] text-muted-foreground truncate font-mono">{root.scanPath}</div>
        </div>
        {!root.pathExists && (
          <Badge variant="destructive" className="shrink-0">
            Path missing
          </Badge>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-muted-foreground">
          {root.comicCount} item{root.comicCount === 1 ? '' : 's'} · last scan {formatLastScan(root.lastScanAt)}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground" title="Auto-scan on interval">
            {root.enabled ? 'Auto' : 'Manual'}
          </span>
          <Switch checked={root.enabled} onCheckedChange={onToggleEnabled} disabled={busy} />
          <Button size="sm" variant="outline" onClick={onRescan} disabled={busy}>
            Rescan
          </Button>
          <Button size="sm" variant="outline" onClick={onEditPath} disabled={busy}>
            Path…
          </Button>
          <Button size="sm" variant="ghost" onClick={onRemove} disabled={busy} className="text-destructive">
            Remove
          </Button>
        </div>
      </div>

      {status && (
        <div
          className={`text-[10px] leading-tight ${
            status.tone === 'running'
              ? 'text-foreground'
              : status.tone === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-muted-foreground'
          }`}
        >
          {status.text}
        </div>
      )}
    </li>
  );
}

export function WatchedRootsSection() {
  const queryClient = useQueryClient();
  const [busyFolder, setBusyFolder] = useState<number | null>(null);
  const [intervalMinutes, setIntervalMinutes] = useState('0');
  const [addOpen, setAddOpen] = useState(false);
  const [editingRoot, setEditingRoot] = useState<api.WatchedRoot | null>(null);
  const [editPath, setEditPath] = useState('');

  const { data: roots, isLoading } = useQuery({
    queryKey: ROOTS_QUERY_KEY,
    queryFn: api.fetchWatchedRoots,
    refetchInterval: 15_000,
  });

  const { data: intervalData } = useQuery({
    queryKey: INTERVAL_QUERY_KEY,
    queryFn: api.fetchAutoRescanInterval,
  });
  useEffect(() => {
    if (intervalData) setIntervalMinutes(String(intervalData.minutes));
  }, [intervalData]);

  const invalidateRoots = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ROOTS_QUERY_KEY });

  // --- interval save ---
  const saveInterval = useMutation({
    mutationFn: (minutes: number) => api.setAutoRescanInterval(minutes),
    onSuccess: (_data, minutes) => {
      showToast(autoRescanSavedMessage(minutes));
      void queryClient.invalidateQueries({ queryKey: INTERVAL_QUERY_KEY });
    },
    onError: (err) => showToast(errorMessage(err, 'Failed to save interval')),
  });

  const handleSaveInterval = () => {
    const minutes = parseAutoRescanMinutes(intervalMinutes);
    if (minutes == null) {
      showToast('Enter a number of minutes (0 to disable).');
      return;
    }
    saveInterval.mutate(minutes);
  };

  // --- per-root mutations (serialized through the busy row) ---
  const runForFolder = async (folderId: number, fn: () => Promise<unknown>): Promise<void> => {
    setBusyFolder(folderId);
    try {
      await fn();
    } catch (err) {
      showToast(errorMessage(err, 'Request failed'));
    } finally {
      setBusyFolder(null);
      await invalidateRoots();
    }
  };

  const toggleEnabled = (root: api.WatchedRoot, enabled: boolean): void => {
    void runForFolder(root.folderId, () => api.updateWatchedRoot(root.folderId, { enabled }));
  };

  const rescan = (root: api.WatchedRoot): void => {
    void runForFolder(root.folderId, async () => {
      const res = await api.rescanRoot(root.folderId);
      showToast(res.alreadyQueued ? 'Scan already queued' : 'Rescan queued');
    });
  };

  const removeRoot = (root: api.WatchedRoot): void => {
    if (!window.confirm(`Remove the watch on "${root.name}"? The folder and its ${root.comicCount} item(s) stay in the library.`)) return;
    void runForFolder(root.folderId, () => api.removeWatchedRoot(root.folderId));
  };

  const openEditPath = (root: api.WatchedRoot): void => {
    setEditingRoot(root);
    setEditPath(root.scanPath);
  };

  const saveEditPath = (): void => {
    if (!editingRoot) return;
    const trimmed = editPath.trim();
    void runForFolder(editingRoot.folderId, async () => {
      await api.updateWatchedRoot(editingRoot.folderId, { scanPath: trimmed === '' ? null : trimmed });
      setEditingRoot(null);
      showToast(trimmed === '' ? 'Watch removed' : 'Scan path updated');
    });
  };

  const addPathSuccess = (): void => {
    setAddOpen(false);
    void invalidateRoots();
  };

  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Watched folders</div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add watched folder
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground leading-normal">
        Registered server paths are rescanned for new files on the interval below — or any time you hit Rescan.
        Missing mounts show an offline badge; nothing appears until the <code className="text-foreground">cb8-worker</code> is running.
      </p>

      {/* Interval control */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Auto-scan every</span>
        {AUTO_RESCAN_PRESETS.map((preset) => (
          <Button
            key={preset}
            size="sm"
            variant={parseAutoRescanMinutes(intervalMinutes) === preset ? 'default' : 'outline'}
            onClick={() => setIntervalMinutes(String(preset))}
            disabled={saveInterval.isPending}
            className={parseAutoRescanMinutes(intervalMinutes) === preset ? 'bg-primary hover:bg-primary/90 text-primary-foreground font-semibold' : 'border-border'}
          >
            {preset === 0 ? 'Off' : `${preset}m`}
          </Button>
        ))}
        <Input
          type="number"
          min="0"
          step="1"
          className="bg-secondary border-border w-20"
          value={intervalMinutes}
          onChange={(event) => setIntervalMinutes(event.target.value)}
          disabled={saveInterval.isPending}
        />
        <span className="text-[10px] text-muted-foreground">min — 0 = manual only</span>
        <Button size="sm" onClick={handleSaveInterval} disabled={saveInterval.isPending}>
          {saveInterval.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {/* Roots list */}
      {isLoading && roots == null ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Loading watched folders…
        </div>
      ) : roots && roots.length === 0 ? (
        <div className="flex items-start gap-2 bg-muted/40 border border-border rounded-lg p-3 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            No watched folders yet. Add one above — pick a path on the host and give it a folder name; it becomes a
            watched root that can be rescanned without re-browsing.
          </span>
        </div>
      ) : (
        <ul className="space-y-2">
          {(roots ?? []).map((root) => (
            <RootRow
              key={root.folderId}
              root={root}
              busy={busyFolder === root.folderId}
              onToggleEnabled={(enabled) => toggleEnabled(root, enabled)}
              onRescan={() => rescan(root)}
              onEditPath={() => openEditPath(root)}
              onRemove={() => removeRoot(root)}
            />
          ))}
        </ul>
      )}

      {/* Add watched folder (reuses the add-path flow) */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-card border-border max-w-sm rounded-lg overflow-hidden max-h-[90vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle className="text-foreground text-left">Add watched folder</DialogTitle>
          </DialogHeader>
          <div className="py-2 min-w-0">
            <p className="text-xs text-muted-foreground text-left mb-2">
              Enter a path on the server host and give the folder a name — it is then registered as a watched root and
              scanned immediately.
            </p>
            <AddPathPanel onSuccess={addPathSuccess} onBack={() => setAddOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit path */}
      <Dialog open={editingRoot != null} onOpenChange={(open) => { if (!open) setEditingRoot(null); }}>
        <DialogContent className="bg-card border-border max-w-sm rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground text-left">Edit scan path</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground text-left">
              Change the watched path for “{editingRoot?.name}”. Leave empty to remove the watch.
            </p>
            <Input
              className="bg-secondary border-border"
              value={editPath}
              onChange={(event) => setEditPath(event.target.value)}
              placeholder="/data/incoming"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="border-border" onClick={() => setEditingRoot(null)}>
                Cancel
              </Button>
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" onClick={saveEditPath}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
