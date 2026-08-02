import React, { useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useReaderStore } from '@/store/readerStore';
import * as api from '@/lib/api';
import ReaderToolbar from '@/components/reader/ReaderToolbar';
import useImmersiveChrome from '@/hooks/useImmersiveChrome';
import useWakeLock from '@/hooks/useWakeLock';
import { useReaderViewportControls } from '@/hooks/useReaderViewportControls';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { determineReaderFormat, initialReaderPage, readerChromeKeyAction } from './readerPageHelpers';

// Lazy-loaded so the heavy reader libraries (pdf.js, epub.js) are split into
// their own chunks and only fetched when a book is actually opened — they stay
// out of the initial library bundle.
const ComicReader = React.lazy(() => import('@/components/reader/ComicReader'));
const EpubReader = React.lazy(() => import('@/components/reader/EpubReader'));
const PdfReader = React.lazy(() => import('@/components/reader/PdfReader'));

/** Elements whose clicks belong to the chrome (or a sheet) rather than the page. */
const CHROME_CLICK_SELECTOR = 'header, button, [role="slider"], [role="dialog"]';

/** Whether a keydown originated in an editable form control. */
function isEditableKeyTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element?.tagName) return false;
  const tag = element.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
}

export default function ReaderPage() {
  const { id, page } = useParams<{ id: string; page?: string }>();
  const comicId = Number(id);
  const navigate = useNavigate();

  const { currentPage, setCurrentPage, resetReader } = useReaderStore();
  const [extraControls, setExtraControls] = React.useState<React.ReactNode>(null);

  // Immersive chrome: hidden when the book opens, toggled by a center tap,
  // revealed by activity, auto-hidden after a pause. Shared by all readers.
  const chrome = useImmersiveChrome();

  // Keep the screen awake while reading.
  useWakeLock();

  const { handleToggleFullscreen } = useReaderViewportControls();

  // Query to fetch comic record details. The reader resumes from
  // record.lastPage / lastLocation, so it must read the *latest* saved progress
  // every time it opens. Don't serve a stale cached record on SPA re-entry
  // (back button → reopen the same book): gcTime 0 drops the cache on unmount so
  // each open refetches — matching a full page refresh, which is exactly why
  // refresh resumed correctly but the back button reset to the start.
  const { data: record, isLoading, error } = useQuery<api.WebComicRecord>({
    queryKey: ['comic', comicId],
    queryFn: () => api.fetchComic(comicId),
    enabled: !isNaN(comicId),
    staleTime: 0,
    gcTime: 0,
  });

  // Sync initial page parameter from URL route or database history on load
  useEffect(() => {
    if (!record) return;

    setCurrentPage(initialReaderPage(page, record.lastPage));

    return () => {
      resetReader();
    };
  }, [page, record, setCurrentPage, resetReader]);

  const handleBack = useCallback(() => {
    // Navigates back to the preceding library location (retains scroll position due to AppShell freezing)
    navigate(-1);
  }, [navigate]);

  // Chrome-level keyboard shortcuts shared by every reader: Escape exits,
  // f toggles fullscreen. Suppressed while typing or while a sheet owns the key.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const action = readerChromeKeyAction(e.key, {
        isEditableTarget: isEditableKeyTarget(target),
        isDialogTarget: Boolean(target?.closest?.('[role="dialog"]')),
        defaultPrevented: e.defaultPrevented,
      });
      if (!action) return;
      e.preventDefault();
      if (action === 'back') handleBack();
      else handleToggleFullscreen();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack, handleToggleFullscreen]);

  // Reader-dispatched chrome commands. The EPUB reader renders into iframes
  // whose events can't bubble out, so it broadcasts these custom events instead.
  useEffect(() => {
    const onToggleToolbar = () => chrome.toggle();
    const onReaderBack = () => handleBack();
    const onReaderFullscreen = () => handleToggleFullscreen();
    window.addEventListener('cb8:reader-toggle-toolbar', onToggleToolbar);
    window.addEventListener('cb8:reader-back', onReaderBack);
    window.addEventListener('cb8:reader-toggle-fullscreen', onReaderFullscreen);
    return () => {
      window.removeEventListener('cb8:reader-toggle-toolbar', onToggleToolbar);
      window.removeEventListener('cb8:reader-back', onReaderBack);
      window.removeEventListener('cb8:reader-toggle-fullscreen', onReaderFullscreen);
    };
  }, [chrome.toggle, handleBack, handleToggleFullscreen]);

  // Center tap/click toggles the chrome; interacting with the chrome itself
  // (toolbar, buttons, slider, sheets) keeps it open instead. Side tap zones in
  // the readers stop propagation, so page turns never reach this handler.
  const handleOverlayClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(CHROME_CLICK_SELECTOR)) {
      chrome.reveal();
      return;
    }
    chrome.toggle();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center w-screen h-screen bg-black text-zinc-400 gap-3 select-none">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm font-medium">Opening book...</span>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="flex flex-col items-center justify-center w-screen h-screen bg-black text-zinc-400 gap-4 select-none">
        <p className="text-sm font-medium text-red-500">Failed to load reader.</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs transition-colors"
        >
          Go Back to Library
        </button>
      </div>
    );
  }

  // Determine which format view to mount
  const format = determineReaderFormat(record);

  const handlePageChange = (pageNum: number) => {
    setCurrentPage(pageNum);
    // Update the URL hash route to keep it synchronized (EPUB might use location string, handled in Phase 8)
    navigate(`/read/${comicId}/${pageNum}`, { replace: true });
  };

  return (
    <div
      id="reader-overlay"
      onClick={handleOverlayClick}
      // Mouse movement reveals the chrome while reading on desktop. Filtered to
      // real mouse pointers: touch taps synthesize a compatibility mousemove
      // right before their click, which would reveal-then-toggle-off the chrome.
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') chrome.reveal();
      }}
      className={cn(
        'relative w-screen h-screen bg-black text-white overflow-hidden flex flex-col select-none',
        chrome.visible ? 'cursor-default' : 'cursor-none',
      )}
    >
      <ReaderToolbar
        title={record.title}
        currentPage={currentPage}
        pageCount={record.pageCount}
        onPageChange={handlePageChange}
        onBack={handleBack}
        visible={chrome.visible}
        onMouseEnter={chrome.onChromeEnter}
        onMouseLeave={chrome.onChromeLeave}
        extraControls={extraControls}
      />

      <div className="flex-1 w-full h-full relative overflow-hidden bg-black flex items-center justify-center">
        <React.Suspense
          fallback={
            <div className="flex items-center justify-center w-full h-full bg-black text-zinc-400">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          }
        >
          {format === 'comic' && (
            <ComicReader
              record={record}
              initialPage={currentPage}
              setExtraControls={setExtraControls}
            />
          )}
          {format === 'epub' && (
            <EpubReader
              record={record}
              initialLocation={page}
              setExtraControls={setExtraControls}
            />
          )}
          {format === 'pdf' && (
            <PdfReader
              record={record}
              initialPage={currentPage}
              setExtraControls={setExtraControls}
            />
          )}
        </React.Suspense>
      </div>
    </div>
  );
}
