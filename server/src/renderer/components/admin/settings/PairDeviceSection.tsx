import React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Smartphone, Eye, EyeOff, AlertTriangle, RefreshCw } from 'lucide-react';

export type PairDeviceSectionProps = {
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
 * QR code + candidate origin selector for fast mobile pairing.
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
