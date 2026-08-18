import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ThemeType } from '@/store/uiStore';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Copy, Trash, Check, Smartphone, AlertTriangle, RefreshCw } from 'lucide-react';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { showToast } from '@/hooks/useToast';
import { formatBytes, type ThemeSwatch } from '../settingsPanelHelpers';

export type TemporaryPasswordSectionProps = {
  tempPassword: string;
  clearingTempPass: boolean;
  onCopy: () => void;
  onClear: () => void;
};

/**
 * Display the current temporary password with copy and clear actions.
 */
export function TemporaryPasswordSection({
  tempPassword,
  clearingTempPass,
  onCopy,
  onClear,
}: TemporaryPasswordSectionProps) {
  return (
    <div className="bg-secondary/40 border border-border p-3.5 rounded-lg space-y-2">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Temporary password</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-secondary border border-border p-1.5 rounded font-mono text-sm break-all font-semibold">
          {tempPassword}
        </code>
        <Button variant="outline" size="icon" onClick={onCopy} title="Copy">
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onClear}
          disabled={clearingTempPass}
          title="Clear"
        >
          <Trash className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground leading-normal">
        Change your password to invalidate this.
      </p>
    </div>
  );
}

export type ThemePickerSectionProps = {
  themes: ThemeSwatch[];
  activeTheme: ThemeType;
  onSelect: (theme: ThemeType) => void;
};

/**
 * Grid of selectable accent-theme swatches.
 */
export function ThemePickerSection({ themes, activeTheme, onSelect }: ThemePickerSectionProps) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Theme</div>
      <div className="grid grid-cols-5 gap-2">
        {themes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            onClick={() => onSelect(theme.id)}
            className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition ${
              activeTheme === theme.id
                ? 'border-primary bg-secondary/80 font-semibold text-foreground'
                : 'border-border bg-secondary/30 hover:bg-secondary/60 text-muted-foreground'
            }`}
          >
            <span
              className="h-6 w-6 rounded-full border border-black/10 shadow-sm flex items-center justify-center"
              style={{ backgroundColor: theme.color }}
            >
              {activeTheme === theme.id && <Check className="h-3 w-3 text-white drop-shadow" />}
            </span>
            <span className="text-[11px] leading-none">{theme.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export type ConnectReaderSectionProps = {
  catalogUrl: string;
  onCopy: () => void;
};

/**
 * OPDS catalog feed link with copy helper.
 */
export function ConnectReaderSection({ catalogUrl, onCopy }: ConnectReaderSectionProps) {
  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-2">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Smartphone className="h-3.5 w-3.5" />
        Connect an external reader (OPDS)
      </div>
      <p className="text-[10px] text-muted-foreground leading-normal">
        Third-party reader apps (Chunky, Panels, Moon+ Reader, Thorium) can browse your library via OPDS.
        Add this catalog URL in the app:
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-secondary border border-border p-1.5 rounded font-mono text-xs break-all text-foreground">
          {catalogUrl}
        </code>
        <Button variant="outline" size="icon" onClick={onCopy} title="Copy catalog URL">
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground leading-normal">
        Use your CB8 username and password when prompted. If you have no password set, you can log in on the web to create one.
      </p>
    </div>
  );
}

export type GuestAccessSectionProps = {
  enabled: boolean;
  pending: boolean;
  onChange: (enabled: boolean) => void;
};

/**
 * Toggle for unauthenticated read-only browsing on the web server.
 */
export function GuestAccessSection({ enabled, pending, onChange }: GuestAccessSectionProps) {
  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Guest access</div>
        <Switch
          id="guest-access-switch"
          checked={enabled}
          disabled={pending}
          onCheckedChange={onChange}
        />
      </div>
      <p className="text-[10px] text-muted-foreground leading-normal">
        Allow anyone on your local network to browse and read your library without logging in.
        Guests cannot edit metadata, add paths, manage users, or change settings.
      </p>
      {enabled && (
        <div className="flex gap-2 bg-amber-500/10 border border-amber-500/20 rounded p-2 text-[10px] text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          <span>
            Reading progress and bookmarks will still be tracked in the browser session, but won&apos;t be saved to a user profile.
          </span>
        </div>
      )}
    </div>
  );
}

export type DangerZoneSectionProps = {
  clearingLibrary: boolean;
  onClearLibrary: () => void;
};

/**
 * Destructive action block for clearing the entire library catalog.
 */
export function DangerZoneSection({ clearingLibrary, onClearLibrary }: DangerZoneSectionProps) {
  return (
    <div className="bg-destructive/10 border border-destructive/20 p-3.5 rounded-lg space-y-2">
      <div className="text-xs font-bold text-destructive uppercase tracking-wider">Danger zone</div>
      <p className="text-xs text-muted-foreground leading-normal">
        Removes every comic, book, folder, collection, tag, and reading-progress record from the database. Users and sessions are kept.{' '}
        <strong>Files on disk are not deleted.</strong>
      </p>
      <Button
        type="button"
        variant="destructive"
        className="w-full font-semibold"
        disabled={clearingLibrary}
        onClick={onClearLibrary}
      >
        {clearingLibrary ? 'Clearing...' : 'Clear library catalog'}
      </Button>
    </div>
  );
}

/**
 * Running server version.
 */
export function ServerInfoSection() {
  const { data } = useQuery({ queryKey: ['server-version'], queryFn: api.fetchServerVersion });
  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-2">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Server</div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">CB8 version</span>
        <span className="text-sm font-semibold text-foreground">{data?.version ?? '…'}</span>
      </div>
    </div>
  );
}

/**
 * On-disk cache footprint + clear action.
 */
export function CacheSection() {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['cache-stats'], queryFn: api.fetchCacheStats });
  const [clearing, setClearing] = useState(false);

  const clear = async () => {
    setClearing(true);
    try {
      await api.clearCache();
      showToast('Caches cleared');
      await refetch();
    } catch (err) {
      showToast(errorMessage(err, 'Failed to clear caches'));
    } finally {
      setClearing(false);
    }
  };

  const rows: Array<[string, api.CacheStats]> = data
    ? [['Image cache', data.imageCache], ['Upscale cache', data.upscaleCache]]
    : [];

  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Caches</div>
        {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-[10px] text-muted-foreground leading-normal">
        Resized page images and GPU-upscaled pages are cached on disk and regenerated on demand, so clearing them is always safe.
      </p>
      <div className="space-y-1">
        {rows.map(([label, stats]) => (
          <div key={label} className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{label}</span>
            <span>
              {stats.fileCount} file{stats.fileCount === 1 ? '' : 's'} · {formatBytes(stats.sizeBytes)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={clear} disabled={clearing || !data}>
          {clearing ? 'Clearing…' : 'Clear caches'}
        </Button>
      </div>
    </div>
  );
}
