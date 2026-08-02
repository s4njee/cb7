import React, { useEffect, useState, useRef, useCallback } from 'react';
import ePub from 'epubjs';
import { useReaderStore } from '@/store/readerStore';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { toast } from 'sonner';
import EpubReaderControls from './EpubReaderControls';
import EpubReaderView from './EpubReaderView';
import { fontFamilyForPrefs, injectGoogleFont, preloadGoogleFont } from './epubReaderFonts';
import {
  attachEpubIframeInteractions,
  createEpubKeyboardHandler,
  epubDocumentFromRenderedView,
} from './epubReaderIframeEvents';
import { resolveEpubDisplayTarget } from './epubReaderLinks';
import { applyEpubThemeToRendition, applyLiveEpubFontSize } from './epubRenditionTheme';
import type { EpubBook, EpubChapter, EpubFactory, EpubRendition, EpubSection } from './EpubReaderTypes';
import type { EpubPrefs } from '@/store/readerStore';
import { getThemeColors } from '../../../shared/epubTheme';

/**
 * @module
 * Main EPUB Reader Component
 * 
 * Architecture overview for Junior Devs:
 * `EpubReader` wraps the third-party `epubjs` library to render reflowable EPUB documents.
 * Unlike the `ComicReader` which renders raw image tags, `epubjs` loads chapter XHTML into 
 * sandboxed `iframes`.
 * 
 * Theme Management:
 * Injecting CSS into cross-origin or dynamically generated iframes is tricky.
 * The `applyThemeColors` function dynamically pushes CSS rules and Google Fonts directly into 
 * the epubjs rendition views and iframe documents to ensure dark mode and custom fonts 
 * apply flawlessly to the book's content.
 */

interface EpubReaderProps {
  record: api.WebComicRecord;
  initialLocation?: string;
  setExtraControls?: (controls: React.ReactNode) => void;
}

export default function EpubReader({
  record,
  initialLocation,
  setExtraControls,
}: EpubReaderProps) {
  const { epubPrefs, setEpubPrefs } = useReaderStore();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const navOverlayRef = useRef<HTMLDivElement | null>(null);
  const epubPrefsRef = useRef(epubPrefs);
  const currentSectionHrefRef = useRef<string | null>(null);
  const currentLocationCfiRef = useRef<string | null>(initialLocation || record.lastLocation || null);
  const linkedIframeDocsRef = useRef(new WeakSet<Document>());
  const bookRef = useRef<EpubBook | null>(null);
  // Tearing the reader down (e.g. the Back button) makes epubjs resize and
  // re-display from the book start, firing a `relocated` at page 1. Persisting
  // that would overwrite the real saved position with the start. We set this on
  // teardown so the relocated handler ignores that final start-of-book event;
  // normal in-reading saves are never gated, so every page turn still persists.
  const closingRef = useRef(false);

  // States
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bookLoading, setBookLoading] = useState(true);

  const [rendition, setRendition] = useState<EpubRendition | null>(null);
  const renditionRef = useRef<EpubRendition | null>(null);

  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  // Whole-book progress percent, or null until the location index has been
  // generated — epub.js only knows section-local progress before that.
  const [currentPercent, setCurrentPercent] = useState<number | null>(null);

  // Sheets visible states
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pageTurnCue, setPageTurnCue] = useState<{ direction: 'next' | 'prev'; key: number } | null>(null);

  // Local state copy for google font input to prevent rapid theme changes on keypress
  const [localGoogleFont, setLocalGoogleFont] = useState(epubPrefs.googleFont || '');
  const pageTurnCueTimerRef = useRef<number | null>(null);

  useEffect(() => {
    epubPrefsRef.current = epubPrefs;
  }, [epubPrefs]);

  useEffect(() => {
    renditionRef.current = rendition;
  }, [rendition]);

  const applyPrefsToCurrentRendition = useCallback((nextPrefs: EpubPrefs) => {
    const currentRendition = renditionRef.current;
    if (!currentRendition) return;

    applyEpubThemeToRendition({
      rendition: currentRendition,
      prefs: nextPrefs,
      fontFamily: fontFamilyForPrefs(nextPrefs),
      injectGoogleFont,
    });
  }, []);

  const handlePrefsChange = useCallback((partial: Partial<EpubPrefs>) => {
    const nextPrefs = { ...epubPrefsRef.current, ...partial };
    epubPrefsRef.current = nextPrefs;
    setEpubPrefs(partial);
    applyPrefsToCurrentRendition(nextPrefs);
    if (partial.fontSize !== undefined && renditionRef.current) {
      applyLiveEpubFontSize(renditionRef.current, partial.fontSize);
    }
  }, [applyPrefsToCurrentRendition, setEpubPrefs]);

  const rerenderCurrentLocation = useCallback((targetRendition = renditionRef.current) => {
    if (!targetRendition) return;

    try {
      targetRendition.resize();
    } catch {}

    const target = currentLocationCfiRef.current;
    window.requestAnimationFrame(() => {
      void targetRendition
        .display(target || undefined)
        .catch(() => {
          try {
            targetRendition.resize();
          } catch {}
        })
        .finally(() => {
          applyPrefsToCurrentRendition(epubPrefsRef.current);
        });
    });
  }, [applyPrefsToCurrentRendition]);

  // 2. Re-apply themes to EpubJS and current iframe contents
  const applyThemeColors = useCallback(() => {
    if (!rendition) return;

    applyEpubThemeToRendition({
      rendition,
      prefs: epubPrefs,
      fontFamily: fontFamilyForPrefs(epubPrefs),
      injectGoogleFont,
    });
  }, [
    rendition,
    epubPrefs,
    epubPrefs.themeMode,
    epubPrefs.fontSize,
    epubPrefs.googleFont,
    epubPrefs.fontFamily,
  ]);

  const resolveDisplayTarget = useCallback((href: string, sectionHref?: string | null): string | number | null => {
    return resolveEpubDisplayTarget(bookRef.current, href, sectionHref, currentSectionHrefRef.current);
  }, []);

  // Preload font if set on load
  useEffect(() => {
    if (epubPrefs.googleFont) {
      preloadGoogleFont(epubPrefs.googleFont);
    }
  }, [epubPrefs.googleFont]);

  // Re-apply theme whenever variables change
  useEffect(() => {
    applyThemeColors();
  }, [applyThemeColors]);

  // 3. Load Book & Render
  useEffect(() => {
    let localBook: EpubBook | null = null;
    let localRendition: EpubRendition | null = null;

    async function loadBook() {
      try {
        const container = containerRef.current;
        if (!container) return;
        closingRef.current = false; // fresh book — not tearing down
        setBookLoading(true);
        const fileUrl = api.fileUrl(record.id);
        const resp = await fetch(fileUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching book`);
        const arrayBuffer = await resp.arrayBuffer();

        const createEpub = ePub as unknown as EpubFactory;
        localBook = createEpub(arrayBuffer);
        bookRef.current = localBook;

        // Fetch TOC
        localBook.loaded.navigation.then((nav) => {
          setChapters(nav.toc || []);
        });

        // Initialize rendition
        const rendered = localBook.renderTo(container, {
          width: '100%',
          height: '100%',
          spread: epubPrefs.spread ? 'auto' : 'none',
          flow: 'paginated',
        });
        localRendition = rendered;
        setRendition(rendered);

        // Setup themes
        const initialPrefs = epubPrefsRef.current;
        applyEpubThemeToRendition({
          rendition: rendered,
          prefs: initialPrefs,
          fontFamily: fontFamilyForPrefs(initialPrefs),
          injectGoogleFont,
        });

        const onKey = createEpubKeyboardHandler(rendered);

        // Relocated state listener
        rendered.on('relocated', (location) => {
          if (!location?.start) return;
          // Only the whole-book location index gives a meaningful percentage;
          // `location.start.percentage` is section-local until
          // `locations.generate()` has run. Rather than briefly showing a
          // misleading per-chapter number, the footer stays hidden (and nothing
          // is persisted) until the index — generated in the background right
          // after first paint — is ready.
          const book = bookRef.current;
          const cfi = location.start.cfi;
          let wholeBookPercent: number | undefined;
          if (cfi && book?.locations && book.locations.length() > 0) {
            const fromIndex = book.locations.percentageFromCfi(cfi);
            if (typeof fromIndex === 'number' && !Number.isNaN(fromIndex)) {
              wholeBookPercent = Math.round(fromIndex * 100);
              setCurrentPercent(wholeBookPercent);
            }
          }
          if (location.start.href) {
            currentSectionHrefRef.current = location.start.href;
          }
          // Persist every page turn. The only relocate we skip is the start-of-book
          // event fired during teardown (see closingRef), which would clobber the
          // real position with page 1.
          if (cfi && !closingRef.current) {
            currentLocationCfiRef.current = cfi;
            api.updateLocation(record.id, cfi, wholeBookPercent).catch(() => {});
          }
        });

        // Rendered view listener
        rendered.on('rendered', (_section, view) => {
          const section = _section as EpubSection | undefined;
          const sectionHref = section?.href || currentSectionHrefRef.current;
          if (sectionHref) {
            currentSectionHrefRef.current = sectionHref;
          }

          try {
            const latestPrefs = epubPrefsRef.current;
            applyEpubThemeToRendition({
              rendition: rendered,
              prefs: latestPrefs,
              fontFamily: fontFamilyForPrefs(latestPrefs),
              targetView: view,
              injectGoogleFont,
            });
          } catch {}

          try {
            const iframeDoc = epubDocumentFromRenderedView(view);
            if (iframeDoc) {
              attachEpubIframeInteractions({
                iframeDoc,
                rendition: rendered,
                keyboardHandler: onKey,
                sectionHref,
                resolveDisplayTarget,
                linkedIframeDocs: linkedIframeDocsRef.current,
                onLinkError: (err) => {
                  toast.error(errorMessage(err, 'Could not open linked section.'));
                },
              });
            }
          } catch {}
        });

        // Attach keys on parent window
        document.addEventListener('keydown', onKey);
        rendered._onKey = onKey;

        // Display book starting CFI
        const startCfi = initialLocation || record.lastLocation || undefined;
        try {
          await rendered.display(startCfi);
          if (startCfi) {
            toast.success('Resuming from saved position');
          }
        } catch {
          currentLocationCfiRef.current = null;
          await rendered.display();
        }

        setBookLoading(false);

        // Build the whole-book location index in the background so the progress
        // footer reflects position across the entire book, not just the current
        // spine section. Generating parses every section, so it can take a beat
        // on large books — hence it runs after the first paint, not before.
        const bookForLocations = localBook;
        const locations = bookForLocations.locations;
        if (bookForLocations.ready && locations) {
          void bookForLocations.ready
            .then(() => locations.generate(1024))
            .then(() => {
              const cfi = currentLocationCfiRef.current;
              if (!cfi) return;
              const fraction = locations.percentageFromCfi(cfi);
              if (typeof fraction === 'number' && !Number.isNaN(fraction)) {
                const percent = Math.round(fraction * 100);
                setCurrentPercent(percent);
                // Persist now that we have a whole-book percentage, so the
                // library card reflects progress even if the reader never moves.
                api.updateLocation(record.id, cfi, percent).catch(() => {});
              }
            })
            .catch(() => {});
        }
      } catch (err) {
        const msg = errorMessage(err, 'Failed to render EPUB.');
        toast.error(msg);
        setLoadError(msg);
        setBookLoading(false);
      }
    }

    loadBook();

    return () => {
      // Mark teardown so the relocated handler ignores the start-of-book event
      // that destroy() triggers (epubjs resizes and re-displays from page 1).
      // Without this, that final relocate would clobber the real saved position.
      // Closing the tab dodges it only because the page dies before the save flushes.
      closingRef.current = true;
      // Flush the *live* position one last time, before destroy() jumps to the
      // start. Page turns already save on relocate, but a Back click can land
      // between the last turn and its relocate event, leaving that page unsaved —
      // so read the rendition's current CFI directly and persist it (with a fresh
      // whole-book percent when the index is ready). The fetch outlives unmount.
      try {
        const liveCfi = localRendition?.location?.start?.cfi || currentLocationCfiRef.current;
        if (liveCfi) {
          const book = bookRef.current;
          let percent: number | undefined;
          if (book?.locations && book.locations.length() > 0) {
            const fraction = book.locations.percentageFromCfi(liveCfi);
            if (typeof fraction === 'number' && !Number.isNaN(fraction)) {
              percent = Math.round(fraction * 100);
            }
          }
          api.updateLocation(record.id, liveCfi, percent).catch(() => {});
        }
      } catch {}
      if (localRendition) {
        if (localRendition._onKey) {
          document.removeEventListener('keydown', localRendition._onKey);
        }
        localRendition.destroy();
      }
      localBook?.destroy?.();
      bookRef.current = null;
    };
  }, [record.id, initialLocation, resolveDisplayTarget]);

  // 4. Handle resizing
  useEffect(() => {
    if (!rendition) return;
    let resizeTimer: number | null = null;

    const handleResize = () => {
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        rerenderCurrentLocation(rendition);
      }, 120);
    };

    window.addEventListener('resize', handleResize);

    let observer: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(handleResize);
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
    };
  }, [rendition, rerenderCurrentLocation]);


  // 5. Navigate chapter
  const triggerPageTurnCue = useCallback((direction: 'next' | 'prev') => {
    if (pageTurnCueTimerRef.current) {
      clearTimeout(pageTurnCueTimerRef.current);
    }
    setPageTurnCue({ direction, key: Date.now() });
      pageTurnCueTimerRef.current = window.setTimeout(() => {
        setPageTurnCue(null);
      }, 360);
  }, []);

  const goPrev = useCallback(() => {
    if (!rendition) return;
    triggerPageTurnCue('prev');
    rendition.prev();
  }, [rendition, triggerPageTurnCue]);

  const goNext = useCallback(() => {
    if (!rendition) return;
    triggerPageTurnCue('next');
    rendition.next();
  }, [rendition, triggerPageTurnCue]);

  useEffect(() => {
    return () => {
      if (pageTurnCueTimerRef.current) {
        clearTimeout(pageTurnCueTimerRef.current);
      }
    };
  }, []);


  const handleChapterClick = (href: string) => {
    if (!rendition) return;
    const displayTarget = resolveDisplayTarget(href);
    if (displayTarget == null) {
      toast.error('Could not open chapter.');
      return;
    }
    // Navigate BEFORE closing the sheet. Closing the sheet toggles the body
    // scrollbar, which fires a window 'resize'; epub.js's onResized handler
    // then re-displays rendition.location.start.cfi. If we close first and
    // navigate after, that resize re-display races our display() and often
    // wins with the OLD location (jumping to the start of the book). By
    // awaiting display() first, rendition.location is already the target
    // chapter by the time the close-triggered resize runs, so onResized
    // re-displays the same chapter instead of clobbering it.
    void rendition
      .display(displayTarget)
      .catch((err) => {
        if (displayTarget === href) throw err;
        return rendition.display(href);
      })
      .catch((err) => toast.error(errorMessage(err, 'Could not open chapter.')))
      .finally(() => setChaptersOpen(false));
  };

  // Sync toolbar action buttons
  useEffect(() => {
    if (!setExtraControls) return;

    setExtraControls(
      <EpubReaderControls
        onOpenChapters={() => setChaptersOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    );
  }, [setExtraControls]);

  // Log history opened/closed
  useEffect(() => {
    api.logHistory(record.id, 'opened', null).catch(() => {});
    return () => {
      api.logHistory(record.id, 'closed', null).catch(() => {});
    };
  }, [record.id]);

  const colors = getThemeColors(epubPrefs.themeMode);

  return (
    <EpubReaderView
      colors={colors}
      containerRef={containerRef}
      navOverlayRef={navOverlayRef}
      bookLoading={bookLoading}
      loadError={loadError}
      chaptersOpen={chaptersOpen}
      settingsOpen={settingsOpen}
      pageTurnCue={pageTurnCue}
      chapters={chapters}
      currentPercent={currentPercent}
      prefs={epubPrefs}
      localGoogleFont={localGoogleFont}
      onPrev={goPrev}
      onNext={goNext}
      onChaptersOpenChange={setChaptersOpen}
      onSettingsOpenChange={setSettingsOpen}
      onChapterClick={handleChapterClick}
      onLocalGoogleFontChange={setLocalGoogleFont}
      onPrefsChange={handlePrefsChange}
      onApplyGoogleFont={() => {
        const font = localGoogleFont.trim();
        const nextPrefs = { ...epubPrefsRef.current, googleFont: font };
        epubPrefsRef.current = nextPrefs;
        setEpubPrefs({ googleFont: font });
        applyPrefsToCurrentRendition(nextPrefs);
        preloadGoogleFont(font);
        toast.success(`Applied google font: ${localGoogleFont}`);
      }}
      onSpreadChange={(checked) => {
        const nextPrefs = { ...epubPrefsRef.current, spread: checked };
        epubPrefsRef.current = nextPrefs;
        setEpubPrefs({ spread: checked });
        const currentRendition = renditionRef.current;
        if (currentRendition) {
          currentRendition.spread(checked ? 'auto' : 'none');
          rerenderCurrentLocation(currentRendition);
          applyPrefsToCurrentRendition(nextPrefs);
        }
      }}
    />
  );
}
