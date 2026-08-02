import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useReaderStore } from '@/store/readerStore';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import useComicGestures from '@/hooks/useComicGestures';
import useComicKeyboard from '@/hooks/useComicKeyboard';
import { useReaderViewportControls } from '@/hooks/useReaderViewportControls';
import { toast } from 'sonner';
import ComicReaderControls from './ComicReaderControls';
import ComicReaderView from './ComicReaderView';
import {
  clampReaderPage,
  comicPageHintLabel,
  hasSecondSpreadPage,
  logicalTurnForPhysicalInput,
  nextComicSpreadPrefs,
  nextComicZoomMode,
  pageStepForSpread,
  preloadNeighborPageIndexes,
  slideClassForPageTurn,
} from './comicReaderRules';

/**
 * @module
 * Main Comic Reader Component
 * 
 * Architecture overview for Junior Devs:
 * `ComicReader` is the heavy-lifter for image-based archives (CBZ/CBR/PDF).
 * It mounts a full-screen overlay and uses native DOM transforms (scale/translate) 
 * for buttery-smooth panning and zooming, bypassing React's render cycle for those rapid interactions.
 * 
 * It coordinates with `useReaderStore` for global preferences (RTL/LTR, spread mode) and manages
 * local state for image preloading and cache warming to ensure the next page is always ready.
 */

interface ComicReaderProps {
  record: api.WebComicRecord;
  initialPage: number;
  setExtraControls?: (controls: React.ReactNode) => void;
}

export default function ComicReader({
  record,
  initialPage,
  setExtraControls,
}: ComicReaderProps) {
  const { prefs, setPrefs, currentPage, setCurrentPage } = useReaderStore();

  const readerBodyRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const prevPageRef = useRef<number>(initialPage);

  // States for images
  const [imgSrc, setImgSrc] = useState<string>('');
  const [img2Src, setImg2Src] = useState<string>('');
  const [imgLoading, setImgLoading] = useState(false);
  const [img2Loading, setImg2Loading] = useState(false);

  // States for page hint
  const [hintText, setHintText] = useState('');
  const [hintVisible, setHintVisible] = useState(false);
  const hintTimerRef = useRef<NodeJS.Timeout | null>(null);

  // State for bookmarks & favorites
  const [bookmarks, setBookmarks] = useState<api.Bookmark[]>([]);
  const [isFavorite, setIsFavorite] = useState(record.favorited);
  const {
    isFullscreen,
    orientationLocked,
    orientationSupported,
    fullscreenSupported,
    isStandalone,
    handleToggleFullscreen,
    handleToggleOrientation,
    handleAddToHomeScreenHint,
  } = useReaderViewportControls();

  // Zoom / Pan local DOM manipulation state
  const panRef = useRef({ scale: 1, tx: 0, ty: 0 });

  // 1. DOM Transform helpers (for maximum performance)
  const applyTransform = useCallback(() => {
    const stage = stageRef.current;
    const body = readerBodyRef.current;
    if (stage) {
      stage.style.transform = `translate(${panRef.current.tx}px, ${panRef.current.ty}px) scale(${panRef.current.scale})`;
    }
    if (body) {
      body.classList.toggle('is-zoomed', panRef.current.scale > 1.001);
    }
  }, []);

  const resetTransform = useCallback(() => {
    panRef.current = { scale: 1, tx: 0, ty: 0 };
    const stage = stageRef.current;
    const body = readerBodyRef.current;
    if (stage) {
      stage.style.transform = '';
    }
    if (body) {
      body.classList.remove('is-zoomed');
    }
  }, []);

  // 2. Fetch Bookmarks
  const loadBookmarks = useCallback(async () => {
    try {
      const list = await api.getBookmarks(record.id);
      setBookmarks(list);
    } catch {}
  }, [record.id]);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  const isBookmarked = bookmarks.some((b) => b.page === currentPage - 1);

  // 3. Preload Cache map. Keyed by page + upscale flag so toggling HD re-fetches
  // (the standard and upscaled variants of a page are different images).
  const preloadCache = useRef<Map<string, Promise<string>>>(new Map());

  const loadPageImg = useCallback((pageIdx: number) => {
    const key = `${pageIdx}:${prefs.upscale ? 1 : 0}`;
    if (preloadCache.current.has(key)) {
      return preloadCache.current.get(key)!;
    }
    const p = new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img.src);
      img.onerror = (err) => reject(err);
      img.src = api.pageUrl(record.id, pageIdx, undefined, prefs.upscale);
    });
    preloadCache.current.set(key, p);
    return p;
  }, [record.id, prefs.upscale]);

  // 4. Navigation
  const pageStep = useCallback(() => pageStepForSpread(prefs.spread), [prefs.spread]);
  const clampPage = useCallback(
    (page: number) => clampReaderPage(page, record.pageCount),
    [record.pageCount],
  );

  // Logical paging: "forward" always advances the page number through the book,
  // regardless of reading direction.
  const goForward = useCallback(() => {
    setCurrentPage(clampPage(currentPage + pageStep()));
  }, [currentPage, pageStep, clampPage, setCurrentPage]);

  const goBackward = useCallback(() => {
    setCurrentPage(clampPage(currentPage - pageStep()));
  }, [currentPage, pageStep, clampPage, setCurrentPage]);

  const goByLogicalTurn = useCallback((turn: 'forward' | 'backward') => {
    if (turn === 'forward') goForward();
    else goBackward();
  }, [goForward, goBackward]);

  const goRight = useCallback(() => {
    goByLogicalTurn(logicalTurnForPhysicalInput(prefs.direction, 'right'));
  }, [prefs.direction, goByLogicalTurn]);

  const goLeft = useCallback(() => {
    goByLogicalTurn(logicalTurnForPhysicalInput(prefs.direction, 'left'));
  }, [prefs.direction, goByLogicalTurn]);

  const handleFirstPage = useCallback(() => {
    setCurrentPage(1);
  }, [setCurrentPage]);

  const handleLastPage = useCallback(() => {
    setCurrentPage(record.pageCount);
  }, [setCurrentPage, record.pageCount]);

  // 5. Actions / Toggles
  const handleCycleZoom = useCallback(() => {
    setPrefs({ zoomMode: nextComicZoomMode(prefs.zoomMode) });
    resetTransform();
  }, [prefs.zoomMode, setPrefs, resetTransform]);

  const handleToggleDirection = useCallback(() => {
    setPrefs({ direction: prefs.direction === 'ltr' ? 'rtl' : 'ltr' });
  }, [prefs.direction, setPrefs]);

  const handleToggleSpread = useCallback(() => {
    setPrefs(nextComicSpreadPrefs(prefs));
    resetTransform();
  }, [prefs, setPrefs, resetTransform]);

  const handleToggleUpscale = useCallback(() => {
    setPrefs({ upscale: !prefs.upscale });
  }, [prefs.upscale, setPrefs]);

  const handleToggleBookmark = useCallback(async () => {
    const pageIndex = currentPage - 1;
    const existing = bookmarks.find((b) => b.page === pageIndex);
    try {
      if (existing) {
        await api.deleteBookmark(record.id, existing.id);
        toast.success('Bookmark removed');
      } else {
        await api.createBookmark(record.id, pageIndex);
        toast.success('Page bookmarked');
      }
      loadBookmarks();
    } catch (err) {
      toast.error(errorMessage(err, 'Bookmark toggle failed'));
    }
  }, [currentPage, bookmarks, record.id, loadBookmarks]);

  const handleToggleFavorite = useCallback(async () => {
    try {
      if (isFavorite) {
        await api.removeFavorite(record.id);
        setIsFavorite(false);
        toast.success('Removed from favorites');
      } else {
        await api.addFavorite(record.id);
        setIsFavorite(true);
        toast.success('Added to favorites');
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Favorite toggle failed'));
    }
  }, [isFavorite, record.id]);

  // Sync extra controls back up to ReaderPage toolbar
  useEffect(() => {
    if (!setExtraControls) return;

    setExtraControls(
      <ComicReaderControls
        prefs={prefs}
        isBookmarked={isBookmarked}
        isFavorite={isFavorite}
        isFullscreen={isFullscreen}
        orientationLocked={orientationLocked}
        orientationSupported={orientationSupported}
        fullscreenSupported={fullscreenSupported}
        isStandalone={isStandalone}
        onCycleZoom={handleCycleZoom}
        onToggleDirection={handleToggleDirection}
        onToggleSpread={handleToggleSpread}
        onToggleUpscale={handleToggleUpscale}
        onToggleOrientation={handleToggleOrientation}
        onToggleBookmark={handleToggleBookmark}
        onToggleFavorite={handleToggleFavorite}
        onToggleFullscreen={handleToggleFullscreen}
        onAddToHomeScreenHint={handleAddToHomeScreenHint}
      />
    );
  }, [
    setExtraControls,
    prefs,
    isBookmarked,
    isFavorite,
    isFullscreen,
    orientationLocked,
    orientationSupported,
    fullscreenSupported,
    isStandalone,
    handleCycleZoom,
    handleToggleDirection,
    handleToggleSpread,
    handleToggleUpscale,
    handleToggleOrientation,
    handleToggleBookmark,
    handleToggleFavorite,
    handleToggleFullscreen,
    handleAddToHomeScreenHint,
  ]);

  // 6. Log history & cleanups
  useEffect(() => {
    const pageIndex = initialPage - 1;
    api.logHistory(record.id, 'opened', pageIndex).catch(() => {});

    return () => {
      // Fetch latest page number from Zustand store for accurate logging on unmount
      const currentPageNum = useReaderStore.getState().currentPage;
      api.logHistory(record.id, 'closed', currentPageNum - 1).catch(() => {});
    };
  }, [record.id, initialPage]);

  // 7. Page Change Effect (Preload, transitions, progress save)
  useEffect(() => {
    let cancelled = false;
    const pageIndex = currentPage - 1;
    setImgLoading(true);

    // Apply slide transition classes
    const stage = stageRef.current;
    if (prefs.transition === 'slide' && stage) {
      stage.classList.remove('slide-from-left', 'slide-from-right');
      void stage.offsetWidth; // Trigger reflow to restart CSS animation

      const prevPage = prevPageRef.current;
      const slideClass = slideClassForPageTurn(prevPage, currentPage);
      if (slideClass) {
        stage.classList.add(slideClass);
      }
    }
    prevPageRef.current = currentPage;

    resetTransform();

    // Load both pages of the spread together and commit them atomically. Loading
    // each image independently lets the left/right <img> update out of step, and
    // (without the `cancelled` guard) lets a slow/stale resolution from a previous
    // page land after a newer one — both of which show mismatched or flickering
    // pages when navigating, most visibly in double-page mode on slower devices
    // like iPad where decode timing is less predictable.
    const hasSecond = hasSecondSpreadPage(prefs.spread, pageIndex, record.pageCount);
    setImg2Loading(hasSecond);

    Promise.all([
      loadPageImg(pageIndex),
      hasSecond ? loadPageImg(pageIndex + 1).catch(() => '') : Promise.resolve(''),
    ])
      .then(([leftSrc, rightSrc]) => {
        if (cancelled) return;
        setImgSrc(leftSrc);
        setImg2Src(rightSrc);
        setImgLoading(false);
        setImg2Loading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setImgLoading(false);
        setImg2Loading(false);
      });

    // Trigger page hint
    setHintText(comicPageHintLabel(prefs.spread, currentPage, record.pageCount));
    setHintVisible(true);

    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
    }
    hintTimerRef.current = setTimeout(() => {
      setHintVisible(false);
    }, 1800);

    // Save reading progress to database
    api.updateProgress(record.id, pageIndex).catch(() => {});

    // Preload neighbors
    for (const neighborPageIndex of preloadNeighborPageIndexes(pageIndex, record.pageCount, prefs.spread)) {
      loadPageImg(neighborPageIndex).catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [
    currentPage,
    prefs.spread,
    prefs.transition,
    loadPageImg,
    record.pageCount,
    record.id,
    resetTransform,
  ]);

  // Clean up hint timers on unmount
  useEffect(() => {
    return () => {
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
      }
    };
  }, []);

  // 8. Attach gesture hooks
  useComicGestures({
    readerBodyRef,
    stageRef,
    panRef,
    applyTransform,
    resetTransform,
    onSwipe: (dir) => {
      // dir 1 = swipe left (physical "right"/advance gesture in LTR); -1 = swipe right.
      if (dir === 1) goRight();
      else goLeft();
    },
    prefs,
  });

  // 9. Attach keyboard hooks
  useComicKeyboard({
    onLeft: goLeft,
    onRight: goRight,
    onForward: goForward,
    onBackward: goBackward,
    onFirstPage: handleFirstPage,
    onLastPage: handleLastPage,
    onCycleZoom: handleCycleZoom,
    onToggleBookmark: handleToggleBookmark,
    onToggleSpread: handleToggleSpread,
    panRef,
    applyTransform,
    resetTransform,
  });

  return (
    <ComicReaderView
      readerBodyRef={readerBodyRef}
      stageRef={stageRef}
      prefs={prefs}
      imgSrc={imgSrc}
      img2Src={img2Src}
      imgLoading={imgLoading}
      img2Loading={img2Loading}
      hintText={hintText}
      hintVisible={hintVisible}
      onTurnLeft={goLeft}
      onTurnRight={goRight}
    />
  );
}
