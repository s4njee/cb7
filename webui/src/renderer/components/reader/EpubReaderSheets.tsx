import type { EpubPrefs } from '@/store/readerStore';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { FONT_FAMILIES, FONT_SIZES, ThemeMode, getThemeColors } from '../../../shared/epubTheme';
import { cn } from '@/lib/utils';

interface EpubChapter {
  href: string;
  label?: string;
}

interface EpubChaptersSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapters: EpubChapter[];
  onChapterClick: (href: string) => void;
  bookTitle?: string;
  currentHref?: string;
}

/** The Folio Contents sidebar — full-height warm drawer, matching the Flutter reader. */
export function EpubChaptersSheet({
  open,
  onOpenChange,
  chapters,
  onChapterClick,
  bookTitle,
  currentHref,
}: EpubChaptersSheetProps) {
  const base = (h: string) => (h || '').split('#')[0].split('?')[0];
  const activeBase = base(currentHref ?? '');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="bg-drawer border-header-rule text-foreground w-[280px] max-w-[85vw] p-6 flex flex-col"
      >
        <SheetHeader className="shrink-0 space-y-3 p-0">
          <SheetTitle className="text-left text-[11px] font-medium uppercase tracking-[0.14em] text-placeholder">
            Contents
          </SheetTitle>
          {bookTitle && (
            <div className="font-serif text-base font-medium leading-tight text-foreground line-clamp-3">
              {bookTitle}
            </div>
          )}
        </SheetHeader>
        <div
          className="flex-1 min-h-0 overflow-y-auto mt-4 no-scrollbar"
          style={{ touchAction: 'pan-y' }}
        >
          {chapters.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-2">No chapters found.</p>
          ) : (
            chapters.map((chapter, index) => {
              const active = activeBase.length > 0 && base(chapter.href) === activeBase;
              return (
                <button
                  key={index}
                  onClick={() => onChapterClick(chapter.href)}
                  className={cn(
                    'w-full text-left py-2.5 text-[13px] leading-snug transition-colors truncate cursor-pointer border-b border-[#191512]',
                    active
                      ? 'rounded-[7px] border-transparent bg-accent-tint px-2.5 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {chapter.label?.trim() || `Chapter ${index + 1}`}
                </button>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface EpubSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: EpubPrefs;
  localGoogleFont: string;
  onLocalGoogleFontChange: (value: string) => void;
  onPrefsChange: (prefs: Partial<EpubPrefs>) => void;
  onApplyGoogleFont: () => void;
  onSpreadChange: (checked: boolean) => void;
}

const THEME_SWATCHES: { mode: ThemeMode; label: string }[] = [
  { mode: 'white', label: 'Light' },
  { mode: 'sepia', label: 'Sepia' },
  { mode: 'black', label: 'Dark' },
];

const settingsLabel = 'text-[10.5px] font-medium uppercase tracking-[0.12em] text-section';

export function EpubSettingsSheet({
  open,
  onOpenChange,
  prefs,
  localGoogleFont,
  onLocalGoogleFontChange,
  onPrefsChange,
  onApplyGoogleFont,
  onSpreadChange,
}: EpubSettingsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-popover-border text-foreground w-[320px] max-w-[85vw] p-6"
      >
        <SheetHeader className="pb-4 p-0">
          <SheetTitle className="text-left text-[11px] font-medium uppercase tracking-[0.14em] text-placeholder">
            Display Settings
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-5 mt-2">
          {/* Reading theme — three swatches */}
          <div className="space-y-2.5">
            <Label className={settingsLabel}>Theme</Label>
            <div className="flex items-center gap-2.5">
              {THEME_SWATCHES.map(({ mode, label }) => {
                const c = getThemeColors(mode);
                const selected = prefs.themeMode === mode;
                return (
                  <button
                    key={mode}
                    aria-label={label}
                    onClick={() => onPrefsChange({ themeMode: mode })}
                    style={{ backgroundColor: c.background, color: c.text }}
                    className={cn(
                      'flex-1 h-10 rounded-lg flex items-center justify-center text-[13px] transition-all',
                      selected ? 'ring-2 ring-primary ring-offset-0' : 'border border-popover-border',
                    )}
                  >
                    Aa
                  </button>
                );
              })}
            </div>
          </div>

          {/* Typeface */}
          <div className="space-y-2.5">
            <Label className={settingsLabel}>Typeface</Label>
            <Select value={prefs.fontFamily} onValueChange={(val) => onPrefsChange({ fontFamily: val })}>
              <SelectTrigger className="bg-card border-border h-9">
                <SelectValue placeholder="Choose Font" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-popover-border text-foreground">
                {FONT_FAMILIES.map((font) => (
                  <SelectItem key={font.value} value={font.value}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Size */}
          <div className="space-y-2.5">
            <Label className={settingsLabel}>Size</Label>
            <Select value={String(prefs.fontSize)} onValueChange={(val) => onPrefsChange({ fontSize: Number(val) })}>
              <SelectTrigger className="bg-card border-border h-9">
                <SelectValue placeholder="Choose Size" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-popover-border text-foreground">
                {FONT_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Google web font */}
          <div className="space-y-2.5">
            <Label className={settingsLabel}>Google Web Font</Label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="e.g. EB Garamond"
                value={localGoogleFont}
                onChange={(event) => onLocalGoogleFontChange(event.target.value)}
                className="bg-card border-border h-9 text-xs"
              />
              <Button variant="secondary" size="sm" onClick={onApplyGoogleFont} className="h-9 text-xs">
                Apply
              </Button>
            </div>
          </div>

          {/* Layout */}
          <div className="flex items-center justify-between pt-2 border-t border-popover-border">
            <div className="flex flex-col gap-0.5">
              <Label className={settingsLabel}>Double Page</Label>
              <span className="text-[10px] text-faint">Two columns in landscape</span>
            </div>
            <Switch checked={prefs.spread} onCheckedChange={onSpreadChange} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
