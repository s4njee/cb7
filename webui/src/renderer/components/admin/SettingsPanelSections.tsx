import type { FormEvent } from 'react';
import type { ThemeType } from '@/store/uiStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Copy, Trash, Check, Smartphone, Eye, EyeOff, AlertTriangle, RefreshCw } from 'lucide-react';
import type { ThemeSwatch } from './settingsPanelHelpers';

/**
 * @module
 * Settings Panel Section Components
 *
 * Architecture overview for Junior Devs:
 * The settings panel was getting large, so each visual block is split out here as
 * its own small, presentational React component. These components are "dumb": they
 * only render UI and call the callbacks passed in via props — all the state,
 * validation, and side effects live in the parent SettingsPanel. The actual
 * parsing/formatting logic lives in `settingsPanelHelpers`. Keeping the sections
 * separate makes the parent easier to read and each block easy to reuse or restyle.
 */

type TemporaryPasswordSectionProps = {
  tempPassword: string;
  clearingTempPass: boolean;
  onCopy: () => void;
  onClear: () => void;
};

/**
 * Display the current temporary password with copy and clear actions.
 * - **tempPassword:** The temporary password to show.
 * - **clearingTempPass:** Whether a clear request is in flight (disables the button).
 * - **onCopy:** Called when the user clicks copy.
 * - **onClear:** Called when the user clicks clear.
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

type ThemePickerSectionProps = {
  themes: ThemeSwatch[];
  activeTheme: ThemeType;
  onSelect: (theme: ThemeType) => void;
};

/**
 * Grid of selectable accent-theme swatches.
 * - **themes:** The available themes to display.
 * - **activeTheme:** The currently selected theme id (highlighted).
 * - **onSelect:** Called with the chosen theme id when a swatch is clicked.
 */
export function ThemePickerSection({ themes, activeTheme, onSelect }: ThemePickerSectionProps) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Theme color</div>
      <div className="grid grid-cols-3 gap-2">
        {themes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            onClick={() => onSelect(theme.id)}
            className={`flex items-center gap-2 p-2 border rounded-lg hover:bg-muted transition text-xs font-semibold cursor-pointer text-foreground ${
              activeTheme === theme.id ? 'border-primary bg-muted' : 'border-border bg-secondary/10'
            }`}
          >
            <span className="h-3.5 w-3.5 rounded-full shrink-0" style={{ backgroundColor: theme.color }} />
            <span className="truncate flex-1">{theme.label}</span>
            {activeTheme === theme.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}

type ConnectReaderSectionProps = {
  catalogUrl: string;
  onCopy: () => void;
};

/**
 * OPDS catalog link for pairing external reader apps with this server.
 * Shown to every signed-in user (OPDS access is not admin-only).
 * - **catalogUrl:** The absolute OPDS catalog URL to display.
 * - **onCopy:** Called when the user clicks copy.
 */
export function ConnectReaderSection({ catalogUrl, onCopy }: ConnectReaderSectionProps) {
  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-2">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Connect a reader app</div>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={catalogUrl}
          className="bg-secondary border-border font-mono text-sm"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button variant="outline" size="icon" onClick={onCopy} title="Copy">
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground leading-normal">
        Point any OPDS reader at this URL to browse and download this library.
      </p>
    </div>
  );
}

type PairDeviceSectionProps = {
  origins: string[];
  selectedOrigin: string;
  onSelectOrigin: (origin: string) => void;
  qrDataUrl: string | null;
  warning: string | null;
  error: string | null;
  revealed: boolean;
  onToggleReveal: () => void;
};

/**
 * "Pair a device" — a QR carrying the server address plus a short-lived,
 * single-use sign-in token, so a phone can join the library by scanning.
 * Shown to every signed-in user (each pairs *as themselves*; the token is bound
 * to the minting user).
 *
 * Two bits of security UX are load-bearing here, not decoration:
 *  - **Reveal-on-click.** The QR is a bearer credential while it lives — anyone
 *    who can see the screen can become you. Settings panels get opened on shared
 *    screens and in screenshares, so the code stays blurred until asked for.
 *  - **The refresh hint.** Users assume a QR is a static address and that
 *    photographing it is harmless. Saying it rotates sets the right expectation:
 *    the photo stops working, and that is on purpose, not a bug.
 *
 * - **origins:** Candidate server addresses, best first.
 * - **selectedOrigin:** The address currently encoded in the QR.
 * - **onSelectOrigin:** Called with the address the user picked.
 * - **qrDataUrl:** Rendered QR as a data URL, or null while loading.
 * - **warning:** Reachability warning to show, or null.
 * - **error:** Error text if the code could not be produced.
 * - **revealed:** Whether the code is currently uncovered.
 * - **onToggleReveal:** Called when the user shows/hides the code.
 */
export function PairDeviceSection({
  origins,
  selectedOrigin,
  onSelectOrigin,
  qrDataUrl,
  warning,
  error,
  revealed,
  onToggleReveal,
}: PairDeviceSectionProps) {
  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Smartphone className="h-3.5 w-3.5" />
          Pair a device
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleReveal}
          className="h-7 gap-1.5 text-xs"
          aria-pressed={revealed}
        >
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {revealed ? 'Hide' : 'Show code'}
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground leading-normal">
        Scan this with the Shelf app on your phone to connect it to this library and sign in as you —
        no password typing.
      </p>

      {warning && (
        <div className="flex gap-2 bg-destructive/10 border border-destructive/20 rounded p-2">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <p className="text-[10px] text-muted-foreground leading-normal">{warning}</p>
        </div>
      )}

      <div className="flex justify-center">
        {error ? (
          <div className="flex items-center justify-center h-[200px] w-[200px] border border-dashed border-border rounded-lg p-3">
            <p className="text-[10px] text-muted-foreground text-center leading-normal">{error}</p>
          </div>
        ) : qrDataUrl ? (
          <div className="relative">
            {/* White plate: scanners need light quiet-zone contrast, which a dark
                theme would otherwise destroy. */}
            <img
              src={qrDataUrl}
              alt={revealed ? `Pairing code for ${selectedOrigin}` : 'Hidden pairing code'}
              width={200}
              height={200}
              className={`rounded-lg bg-white p-2 transition ${revealed ? '' : 'blur-md select-none'}`}
            />
            {!revealed && (
              <button
                type="button"
                onClick={onToggleReveal}
                className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/40 text-xs font-semibold text-foreground hover:bg-background/25 transition cursor-pointer"
              >
                <span className="flex items-center gap-1.5 bg-background/90 border border-border rounded-full px-3 py-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  Show code
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className="h-[200px] w-[200px] rounded-lg border border-dashed border-border animate-pulse" />
        )}
      </div>

      {origins.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="pair-origin" className="text-[10px] text-muted-foreground">
            Server address
          </Label>
          <select
            id="pair-origin"
            value={selectedOrigin}
            onChange={(event) => onSelectOrigin(event.target.value)}
            className="w-full bg-secondary border border-border rounded-md px-2 py-1.5 text-xs font-mono text-foreground"
          >
            {origins.map((origin) => (
              <option key={origin} value={origin}>
                {origin}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground leading-normal">
            Pick the address your phone can reach this server on.
          </p>
        </div>
      )}

      {origins.length === 1 && (
        <p className="text-center text-[10px] font-mono text-muted-foreground break-all">{selectedOrigin}</p>
      )}

      <p className="text-[10px] text-muted-foreground leading-normal flex items-start gap-1.5">
        <RefreshCw className="h-3 w-3 shrink-0 mt-0.5" />
        <span>
          This code signs someone in as you and expires after 2 minutes — it refreshes automatically, so
          a screenshot won&apos;t work. Don&apos;t share it.
        </span>
      </p>
    </div>
  );
}

type GuestAccessSectionProps = {
  enabled: boolean;
  pending: boolean;
  onChange: (enabled: boolean) => void;
};

/**
 * Toggle for unauthenticated read-only browsing on the web server.
 * - **enabled:** Whether guest access is currently on.
 * - **pending:** Whether a change is in flight (disables the switch).
 * - **onChange:** Called with the new enabled state when toggled.
 */
export function GuestAccessSection({ enabled, pending, onChange }: GuestAccessSectionProps) {
  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-2">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="guest-access" className="text-sm text-foreground cursor-pointer select-none">
            Guest access
          </Label>
          <p className="text-[10px] text-muted-foreground leading-normal">
            Allows unauthenticated read-only browsing on the web server.
          </p>
        </div>
        <Switch
          id="guest-access"
          checked={enabled}
          onCheckedChange={onChange}
          disabled={pending}
          className="data-[state=checked]:bg-primary"
        />
      </div>
    </div>
  );
}

type AutoRescanSectionProps = {
  rescanInterval: string;
  savingRescan: boolean;
  onIntervalChange: (minutes: string) => void;
  onSubmit: (event: FormEvent) => void;
};

/**
 * Form for the automatic folder-rescan interval (0 disables).
 * - **rescanInterval:** The interval value (minutes) bound to the input.
 * - **savingRescan:** Whether a save is in flight (disables inputs).
 * - **onIntervalChange:** Called with the new interval string as the user types.
 * - **onSubmit:** Called when the form is submitted.
 */
export function AutoRescanSection({
  rescanInterval,
  savingRescan,
  onIntervalChange,
  onSubmit,
}: AutoRescanSectionProps) {
  return (
    <form onSubmit={onSubmit} className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-3">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Auto-rescan folders</div>
      <p className="text-[10px] text-muted-foreground leading-normal">
        Automatically rescan all folders for new files. Only directories modified since the last scan are checked.
        Set to 0 to disable.
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="0"
          step="1"
          className="bg-secondary border-border w-24"
          value={rescanInterval}
          onChange={(event) => onIntervalChange(event.target.value)}
          disabled={savingRescan}
        />
        <span className="text-sm text-muted-foreground">minutes</span>
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          disabled={savingRescan}
        >
          {savingRescan ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

type DangerZoneSectionProps = {
  clearingLibrary: boolean;
  onClearLibrary: () => void;
};

/**
 * Destructive action block for clearing the entire library catalog.
 * Wipes catalog records only; files on disk and user accounts are kept.
 * - **clearingLibrary:** Whether a clear is in flight (disables the button).
 * - **onClearLibrary:** Called when the user confirms clearing the library.
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
        onClick={onClearLibrary}
        disabled={clearingLibrary}
      >
        {clearingLibrary ? 'Clearing catalog...' : 'Clear library'}
      </Button>
    </div>
  );
}
