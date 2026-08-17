import React, { type ReactNode } from 'react';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useReaderStore, type ReaderPrefs } from '@/store/readerStore';
import { FONT_FAMILIES, FONT_SIZES, getThemeColors, type ThemeMode } from '../../../../shared/epubTheme';
import { cn } from '@/lib/utils';

const READER_ZOOM: Array<{ value: ReaderPrefs['zoomMode']; label: string }> = [
  { value: 'fit-height', label: 'Fit height' },
  { value: 'fit-width', label: 'Fit width' },
  { value: 'original', label: 'Original' },
];
const READER_DIRECTION: Array<{ value: ReaderPrefs['direction']; label: string }> = [
  { value: 'ltr', label: 'LTR' },
  { value: 'rtl', label: 'RTL' },
];
const READER_TRANSITION: Array<{ value: ReaderPrefs['transition']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'slide', label: 'Slide' },
  { value: 'fade', label: 'Fade' },
];
const READER_SPREAD: Array<{ value: ReaderPrefs['spread']; label: string }> = [
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
];
const EPUB_FLOW: Array<{ value: 'paginated' | 'scrolled'; label: string }> = [
  { value: 'paginated', label: 'Paginated' },
  { value: 'scrolled', label: 'Scrolled' },
];
const THEME_SWATCHES: { mode: ThemeMode; label: string }[] = [
  { mode: 'white', label: 'Light' },
  { mode: 'sepia', label: 'Sepia' },
  { mode: 'black', label: 'Dark' },
];

/** A labelled setting row: label left, control right (fixed width so rows align). */
function PrefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="w-[55%] shrink-0">{children}</div>
    </div>
  );
}

/** Small segmented control for enum reader prefs. */
function Segmented<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value)}
          aria-pressed={value === opt.value}
          className={cn(
            'h-8 flex-1 rounded-md text-xs font-medium transition-colors',
            value === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'border border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Reader defaults: edits the same `readerStore` the readers use, so a
 * user can set comic + EPUB preferences from Settings without opening a book.
 */
export function ReaderDefaultsSection() {
  const { prefs, setPrefs, epubPrefs, setEpubPrefs } = useReaderStore();

  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-4">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Reader defaults</div>

      <div className="space-y-3">
        <div className="text-xs font-semibold text-muted-foreground">Comics</div>
        <PrefRow label="Zoom">
          <Segmented options={READER_ZOOM} value={prefs.zoomMode} onSelect={(zoomMode) => setPrefs({ zoomMode })} />
        </PrefRow>
        <PrefRow label="Direction">
          <Segmented options={READER_DIRECTION} value={prefs.direction} onSelect={(direction) => setPrefs({ direction })} />
        </PrefRow>
        <PrefRow label="Page turn">
          <Segmented options={READER_TRANSITION} value={prefs.transition} onSelect={(transition) => setPrefs({ transition })} />
        </PrefRow>
        <PrefRow label="Spread">
          <Segmented options={READER_SPREAD} value={prefs.spread} onSelect={(spread) => setPrefs({ spread })} />
        </PrefRow>
        <PrefRow label="HD upscaling">
          <Switch checked={prefs.upscale} onCheckedChange={(upscale) => setPrefs({ upscale })} />
        </PrefRow>
      </div>

      <div className="space-y-3 border-t border-border pt-3">
        <div className="text-xs font-semibold text-muted-foreground">E-books (EPUB)</div>
        <PrefRow label="Theme">
          <div className="flex items-center gap-1.5">
            {THEME_SWATCHES.map(({ mode, label }) => {
              const c = getThemeColors(mode);
              return (
                <button
                  key={mode}
                  type="button"
                  aria-label={label}
                  onClick={() => setEpubPrefs({ themeMode: mode })}
                  style={{ backgroundColor: c.background, color: c.text }}
                  className={cn(
                    'flex-1 h-8 rounded-md flex items-center justify-center text-[12px] transition-all',
                    epubPrefs.themeMode === mode ? 'ring-2 ring-primary' : 'border border-border',
                  )}
                >
                  Aa
                </button>
              );
            })}
          </div>
        </PrefRow>
        <PrefRow label="Typeface">
          <Select value={epubPrefs.fontFamily} onValueChange={(fontFamily) => setEpubPrefs({ fontFamily })}>
            <SelectTrigger className="bg-card border-border h-8">
              <SelectValue placeholder="Font" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-popover-border text-foreground">
              {FONT_FAMILIES.map((font) => (
                <SelectItem key={font.value} value={font.value}>
                  {font.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PrefRow>
        <PrefRow label="Font size">
          <Select value={String(epubPrefs.fontSize)} onValueChange={(val) => setEpubPrefs({ fontSize: Number(val) })}>
            <SelectTrigger className="bg-card border-border h-8">
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-popover-border text-foreground">
              {FONT_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PrefRow>
        <PrefRow label="Line spacing">
          <Slider
            value={[epubPrefs.lineSpacing]}
            min={1.2}
            max={2.2}
            step={0.1}
            onValueChange={(val) => setEpubPrefs({ lineSpacing: val[0] })}
            className="cursor-pointer [&_[role=slider]]:bg-primary [&_[role=slider]]:border-primary [&_.bg-primary]:bg-primary [&_.bg-secondary]:bg-progress-track"
          />
        </PrefRow>
        <PrefRow label="Margins">
          <Slider
            value={[epubPrefs.pageMargin]}
            min={12}
            max={80}
            step={4}
            onValueChange={(val) => setEpubPrefs({ pageMargin: val[0] })}
            className="cursor-pointer [&_[role=slider]]:bg-primary [&_[role=slider]]:border-primary [&_.bg-primary]:bg-primary [&_.bg-secondary]:bg-progress-track"
          />
        </PrefRow>
        <PrefRow label="Layout">
          <Segmented options={EPUB_FLOW} value={epubPrefs.flow} onSelect={(flow) => setEpubPrefs({ flow })} />
        </PrefRow>
        <PrefRow label="Double page">
          <Switch checked={epubPrefs.spread} onCheckedChange={(spread) => setEpubPrefs({ spread })} />
        </PrefRow>
      </div>
    </div>
  );
}
