import type { Ref } from 'react';
import { Loader2 } from 'lucide-react';
import type { EpubPrefs } from '@/store/readerStore';
import { cn } from '@/lib/utils';
import { EpubChaptersSheet, EpubSettingsSheet } from './EpubReaderSheets';
import type { EpubChapter } from './EpubReaderTypes';

/**
 * @module
 * EPUB Reader Presentational View
 *
 * Architecture overview for Junior Devs:
 * This is the "view" half of the EPUB reader, split out from the container that
 * owns all the state and epub.js wiring. It is purely presentational: it renders
 * the epub.js mount target, loading/error overlays, the left/right tap zones, the
 * page-turn animation cue, the chapters/settings sheets, and the progress footer —
 * and it reports user intent back through the `on*` callback props. It holds no
 * state of its own, which keeps the rendering easy to reason about and the
 * container free to focus on logic.
 */

type EpubThemeColors = {
  background: string;
};

type PageTurnCue = {
  direction: 'next' | 'prev';
  key: number;
} | null;

interface EpubReaderViewProps {
  colors: EpubThemeColors;
  containerRef: Ref<HTMLDivElement>;
  navOverlayRef: Ref<HTMLDivElement>;
  bookLoading: boolean;
  loadError: string | null;
  chaptersOpen: boolean;
  settingsOpen: boolean;
  pageTurnCue: PageTurnCue;
  chapters: EpubChapter[];
  /** Whole-book progress percent, or null until the location index is ready. */
  currentPercent: number | null;
  prefs: EpubPrefs;
  localGoogleFont: string;
  onPrev: () => void;
  onNext: () => void;
  onChaptersOpenChange: (open: boolean) => void;
  onSettingsOpenChange: (open: boolean) => void;
  onChapterClick: (href: string) => void;
  onLocalGoogleFontChange: (value: string) => void;
  onPrefsChange: (prefs: Partial<EpubPrefs>) => void;
  onApplyGoogleFont: () => void;
  onSpreadChange: (checked: boolean) => void;
}

/**
 * Render the EPUB reader UI from props supplied by its container.
 * Stateless view component. Refs are wired into the epub.js mount target
 *          and the navigation overlay; the various `on*` props are invoked on user
 *          actions (page turns, opening sheets, changing preferences). See
 *          `EpubReaderViewProps` for the full prop contract.
 * @param props The reader's display state (colors, loading/error, chapters,
 *              progress, prefs) plus the refs and event callbacks.
 * @returns The rendered EPUB reader view.
 */
export default function EpubReaderView({
  colors,
  containerRef,
  navOverlayRef,
  bookLoading,
  loadError,
  chaptersOpen,
  settingsOpen,
  pageTurnCue,
  chapters,
  currentPercent,
  prefs,
  localGoogleFont,
  onPrev,
  onNext,
  onChaptersOpenChange,
  onSettingsOpenChange,
  onChapterClick,
  onLocalGoogleFontChange,
  onPrefsChange,
  onApplyGoogleFont,
  onSpreadChange,
}: EpubReaderViewProps) {
  return (
    <div
      style={{ backgroundColor: colors.background }}
      className="w-full h-full relative overflow-hidden flex flex-col pt-[3.25rem]"
    >
      {/* epub.js render target. This must stay mounted while loading; the setup
          effect needs `containerRef.current` before it can create the rendition. */}
      <div
        ref={containerRef}
        id="epub-container"
        className="flex-1 w-full h-full relative"
        style={{ backgroundColor: colors.background }}
      />

      {bookLoading && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 text-zinc-400 select-none"
          style={{ backgroundColor: colors.background }}
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm font-medium">Loading digital book...</span>
        </div>
      )}

      {loadError && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center p-8 text-center text-zinc-400 gap-3"
          style={{ backgroundColor: colors.background }}
        >
          <p className="text-sm font-semibold text-red-500">{loadError}</p>
        </div>
      )}

      <div
        ref={navOverlayRef}
        className="absolute inset-x-0 top-[3.25rem] bottom-0 z-20 pointer-events-none"
      >
        <button
          type="button"
          aria-label="Previous EPUB page"
          className="absolute inset-y-0 left-0 w-[15%] cursor-w-resize bg-transparent pointer-events-auto disabled:pointer-events-none"
          disabled={chaptersOpen || settingsOpen}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPrev();
          }}
        />
        <button
          type="button"
          aria-label="Next EPUB page"
          className="absolute inset-y-0 right-0 w-[15%] cursor-e-resize bg-transparent pointer-events-auto disabled:pointer-events-none"
          disabled={chaptersOpen || settingsOpen}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onNext();
          }}
        />
      </div>

      {pageTurnCue && (
        <div
          key={pageTurnCue.key}
          aria-hidden="true"
          className={cn(
            'epub-page-turn-cue',
            pageTurnCue.direction === 'next' ? 'next' : 'prev',
          )}
        />
      )}

      <EpubChaptersSheet
        open={chaptersOpen}
        onOpenChange={onChaptersOpenChange}
        chapters={chapters}
        onChapterClick={onChapterClick}
      />

      <EpubSettingsSheet
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        prefs={prefs}
        localGoogleFont={localGoogleFont}
        onLocalGoogleFontChange={onLocalGoogleFontChange}
        onPrefsChange={onPrefsChange}
        onApplyGoogleFont={onApplyGoogleFont}
        onSpreadChange={onSpreadChange}
      />

      {currentPercent !== null && (
        <footer className="absolute bottom-4 left-4 z-40 bg-black/60 backdrop-blur-xs px-2.5 py-1 rounded text-[10px] font-semibold font-mono text-zinc-400 pointer-events-none select-none">
          {currentPercent}% read
        </footer>
      )}
    </div>
  );
}
