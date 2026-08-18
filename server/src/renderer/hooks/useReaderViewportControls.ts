import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

type ReaderOrientationLock =
  | 'any'
  | 'natural'
  | 'landscape'
  | 'portrait'
  | 'portrait-primary'
  | 'portrait-secondary'
  | 'landscape-primary'
  | 'landscape-secondary';

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: ReaderOrientationLock) => Promise<void>;
  unlock?: () => void;
};

function readerFullscreenTarget(): HTMLElement {
  return document.getElementById('reader-overlay') || document.documentElement;
}

/**
 * Whether the Fullscreen API can fullscreen an arbitrary element. iOS Safari
 * only supports fullscreen for <video>, so `requestFullscreen` is absent on
 * elements there — the toggle would be a no-op. Detect that so the UI can offer
 * "Add to Home Screen" instead.
 */
function detectFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  return typeof document.documentElement.requestFullscreen === 'function';
}

/** Whether the app is running as an installed, chrome-free PWA. */
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    iosStandalone === true ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches)
  );
}

export function useReaderViewportControls() {
  const orientation = useMemo<LockableScreenOrientation | null>(() => {
    if (typeof screen === 'undefined') return null;
    return (screen.orientation as LockableScreenOrientation | undefined) ?? null;
  }, []);

  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [orientationLocked, setOrientationLocked] = useState(false);
  const orientationSupported = typeof orientation?.lock === 'function';
  const fullscreenSupported = useMemo(detectFullscreenSupported, []);
  const isStandalone = useMemo(detectStandalone, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      readerFullscreenTarget().requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  const handleAddToHomeScreenHint = useCallback(() => {
    toast.info('Tap the Share icon, then "Add to Home Screen" for a fullscreen reader.', {
      duration: 6000,
    });
  }, []);

  const handleToggleOrientation = useCallback(async () => {
    if (!orientationSupported) return;
    try {
      if (orientationLocked) {
        orientation?.unlock?.();
        setOrientationLocked(false);
        return;
      }

      if (!document.fullscreenElement) {
        await readerFullscreenTarget().requestFullscreen?.().catch(() => {});
      }
      await orientation?.lock?.('landscape');
      setOrientationLocked(true);
    } catch {
      toast.error('Orientation lock not available');
    }
  }, [orientation, orientationLocked, orientationSupported]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    return () => {
      if (!orientationSupported) return;
      try {
        orientation?.unlock?.();
      } catch {}
    };
  }, [orientation, orientationSupported]);

  return {
    isFullscreen,
    orientationLocked,
    orientationSupported,
    fullscreenSupported,
    isStandalone,
    handleToggleFullscreen,
    handleToggleOrientation,
    handleAddToHomeScreenHint,
  };
}
