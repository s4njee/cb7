import React, { useRef, useState, useEffect } from 'react';
import { useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import FolioHeader from './FolioHeader';
import CommandPalette from './CommandPalette';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useDrop } from '@/hooks/useDrop';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { RefreshCw, Upload } from 'lucide-react';

// Import pages for the routes
import AllPage from '@/pages/AllPage';
import RecentPage from '@/pages/RecentPage';
import ContinuePage from '@/pages/ContinuePage';
import LibraryPage from '@/pages/LibraryPage';
import TagPage from '@/pages/TagPage';
import ReaderPage from '@/pages/ReaderPage';
import {
  CollectionsPage,
  FoldersPage,
  TagsPage,
  FinishedPage,
} from '@/pages/LandingPages';
import {
  FolderPage,
  FolderSeriesPage,
  FolderVolumePage,
  FolderChapterPage,
} from '@/pages/FolderPages';
import {
  BrowseSeriesPage,
  BrowseVolumePage,
  BrowseChapterPage,
} from '@/pages/BrowsePages';
import { ResetPasswordPage, VerifiedPage } from '@/pages/AuthPages';
import LoginPage from '@/pages/LoginPage';

// Lazy-loaded so the admin-only panels (settings, user management, ingest)
// stay out of the initial library bundle — they're only fetched when an admin
// actually opens them.
const SettingsPage = React.lazy(() => import('@/pages/SettingsPage'));
const UsersPage = React.lazy(() => import('@/pages/UsersPage'));
const AdminModal = React.lazy(() => import('@/components/admin/AdminModal'));

/**
 * @module
 * The Persistent App Layout and Route Table
 *
 * Architecture overview for Junior Devs:
 * This is the renderer's hub — the component every page renders inside. If you're
 * looking for "where are the routes defined?" or "what's always on screen?", it's
 * here. Responsibilities:
 *  - Declares the `<Routes>` table mapping URL paths to page components. **Add a
 *    new page by importing it above and adding a `<Route>` here.**
 *  - Renders the persistent chrome: `Navbar`, `Sidebar`, mobile `TabBar`, the
 *    `SortSheet`, the `AdminModal`, and toast `Toaster`.
 *  - Hosts global interactions: the drag-and-drop ingest overlay (`useDrop`) and
 *    pull-to-refresh (`usePullToRefresh`).
 */

/** The top-level layout shell that wraps and routes all pages. */
export default function AppShell() {
  const [adminPanel, setAdminPanel] = useState<string | null>(null);
  // Whether the lazy AdminModal chunk has ever been requested. Kept mounted
  // after the first open so the dialog's close animation still plays.
  const [adminMounted, setAdminMounted] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<{ file: File; relPath: string }[]>([]);
  const location = useLocation();
  const queryClient = useQueryClient();
  const mainScrollRef = useRef<HTMLElement | null>(null);

  const openAdminModal = (panel: string) => {
    setAdminMounted(true);
    setAdminPanel(panel);
  };

  const { dragging } = useDrop({
    onFilesDropped: (files) => {
      setDroppedFiles(files);
      openAdminModal('upload');
    }
  });

  // Warm the reader chunks (comic/epub/pdf) once the browser is idle so opening
  // a book doesn't stall on a network fetch. The library shell paints first;
  // these only fill the HTTP cache. Safari lacks requestIdleCallback.
  useEffect(() => {
    const prefetch = () => {
      void import('@/components/reader/ComicReader').catch(() => {});
      void import('@/components/reader/EpubReader').catch(() => {});
      void import('@/components/reader/PdfReader').catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(prefetch);
    else window.setTimeout(prefetch, 2000);
  }, []);
  const { pullOffset, pullState } = usePullToRefresh(mainScrollRef, () =>
    invalidateLibraryQueries(queryClient)
  );
  const showPullRefreshIndicator = pullOffset > 0 || pullState === 'refreshing';

  const isReader = location.pathname.startsWith('/read');

  // Frozen library location to keep library component fully alive while reading
  const [lastLibraryLocation, setLastLibraryLocation] = useState(location);

  useEffect(() => {
    if (!location.pathname.startsWith('/read')) {
      setLastLibraryLocation(location);
    }
  }, [location]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* 1. Folio top header (hidden while reading) */}
      {!isReader && <FolioHeader onOpenAdminModal={openAdminModal} />}

      {/* 2. Main Shell Layout Container */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Library pages container (hidden when reader is open, but stays mounted) */}
          <div className={cn("flex-1 min-h-0 flex flex-col overflow-hidden", isReader && "hidden")}>
            <main ref={mainScrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-y-none">
            {showPullRefreshIndicator && (
              <div
                className={cn("ptr-indicator", pullState)}
                style={{ transform: `translateY(${pullOffset}px)` }}
              >
                <div className="ptr-spinner flex items-center justify-center">
                  {pullState === 'refreshing' && <RefreshCw className="h-4 w-4 text-primary animate-spin" />}
                </div>
              </div>
            )}
            {/* Suspense catches the lazy admin pages while their chunk loads. */}
            <React.Suspense
              fallback={
                <div className="flex items-center justify-center py-20 text-muted-foreground select-none">
                  <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                </div>
              }
            >
            <Routes location={lastLibraryLocation}>
              <Route path="/" element={<AllPage />} />
              <Route path="recent" element={<RecentPage />} />
              <Route path="continue" element={<ContinuePage />} />
              <Route path="finished" element={<FinishedPage />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="folders" element={<FoldersPage />} />
              <Route path="tags" element={<TagsPage />} />
              <Route path="login" element={<LoginPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="reset-password" element={<ResetPasswordPage />} />
              <Route path="verified" element={<VerifiedPage />} />
              <Route path="library/:id" element={<LibraryPage />} />
              <Route path="folder/:id/series/:k/volume/:v/chapter/:c" element={<FolderChapterPage />} />
              <Route path="folder/:id/series/:k/volume/:v" element={<FolderVolumePage />} />
              <Route path="folder/:id/series/:k" element={<FolderSeriesPage />} />
              <Route path="folder/:id" element={<FolderPage />} />
              <Route path="browse/series/:k/volume/:v/chapter/:c" element={<BrowseChapterPage />} />
              <Route path="browse/series/:k/volume/:v" element={<BrowseVolumePage />} />
              <Route path="browse/series/:k" element={<BrowseSeriesPage />} />
              <Route path="tag/:name" element={<TagPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </React.Suspense>
            </main>
          </div>

          {/* Reader Overlay (renders as active overlay, unmounts reader on exit) */}
          {isReader && (
            <main className="flex-1 overflow-hidden h-screen w-screen bg-black">
              <Routes location={location}>
                <Route path="read/:id" element={<ReaderPage />} />
                <Route path="read/:id/:page" element={<ReaderPage />} />
              </Routes>
            </main>
          )}
        </div>
      </div>

      {/* Global command palette (⌘K) */}
      <CommandPalette />

      {/* Admin Action Modal Dialog (lazy: only fetched once an admin opens it) */}
      {adminMounted && (
        <React.Suspense fallback={null}>
          <AdminModal
            open={adminPanel !== null}
            onOpenChange={(open) => {
              if (!open) {
                setAdminPanel(null);
                setDroppedFiles([]);
              }
            }}
            initialPanel={adminPanel}
            droppedFiles={droppedFiles}
          />
        </React.Suspense>
      )}

      {/* Global Drag-and-drop Overlay */}
      {dragging && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none transition-all duration-300">
          <div className="border-4 border-dashed border-primary/50 rounded-2xl p-12 flex flex-col items-center gap-4 bg-card/60 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <Upload className="h-16 w-16 text-primary animate-bounce" />
            <span className="text-2xl font-bold text-foreground">Drop to add to library</span>
            <span className="text-sm text-muted-foreground">Supports .cbz, .cbr, .epub, .pdf, .mobi</span>
          </div>
        </div>
      )}

      {/* sonner notifications */}
      <Toaster theme="dark" closeButton />
    </div>
  );
}
