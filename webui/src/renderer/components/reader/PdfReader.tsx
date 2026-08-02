import React, { useEffect, useState, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a hashed asset URL at build time, so the worker is
// bundled and served same-origin — no CDN, works offline / on LAN / in Electron.
import PdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useReaderStore } from '@/store/readerStore';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  clampPdfPage,
  isPdfRenderCancellation,
  pdfKeyboardAction,
  pdfSwipeAction,
  pdfTapAction,
} from './pdfReaderRules';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorkerUrl;

interface PdfReaderProps {
  record: api.WebComicRecord;
  initialPage: number;
  /** Kept for ReaderPage prop-shape parity; PDF currently has no extra toolbar controls. */
  setExtraControls?: (controls: React.ReactNode) => void;
}

export default function PdfReader({
  record,
  initialPage,
}: PdfReaderProps) {
  const { currentPage, setCurrentPage } = useReaderStore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Loading States
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pageRendering, setPageRendering] = useState(false);

  // PDF state refs
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const touchStartXRef = useRef<number>(0);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  // Load the PDF document. We hand pdf.js the URL (not a pre-fetched
  // ArrayBuffer) so it streams via HTTP Range requests — the server advertises
  // `Accept-Ranges: bytes` on /file — and only pulls the bytes each page needs.
  // This makes the first page appear almost immediately instead of waiting for
  // the entire (often large) PDF to transfer.
  useEffect(() => {
    let active = true;
    const loadingTask = pdfjsLib.getDocument({
      url: api.fileUrl(record.id),
      withCredentials: true,
      rangeChunkSize: 1 << 16, // 64 KB chunks
      disableAutoFetch: true, // don't eagerly pull the whole file in the background
    });

    async function loadPdf() {
      try {
        setPdfLoading(true);
        setLoadError(null);

        const pdf = await loadingTask.promise;
        if (!active) return;

        pdfDocRef.current = pdf;

        // Restore page progress
        const startPage = clampPdfPage(initialPage, pdf.numPages);
        setCurrentPage(startPage);

        setPdfLoading(false);
      } catch (err) {
        if (!active) return;
        const message = errorMessage(err, 'Failed to load PDF document.');
        toast.error(message);
        setLoadError(message);
        setPdfLoading(false);
      }
    }

    loadPdf();

    return () => {
      active = false;
      pdfDocRef.current = null;
      void loadingTask.destroy();
    };
  }, [record.id, initialPage, setCurrentPage]);

  // 3. Render page onto Canvas (high-DPI scale matching device pixels)
  const renderPage = useCallback(async (pageNum: number) => {
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) return;

    try {
      setPageRendering(true);

      // Cancel any ongoing rendering tasks
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const page = await pdf.getPage(pageNum);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: dpr });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.maxWidth = '100%';
      canvas.style.height = 'auto';

      renderTaskRef.current = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
      });

      await renderTaskRef.current.promise;
      renderTaskRef.current = null;
      setPageRendering(false);
    } catch (err) {
      if (!isPdfRenderCancellation(err)) {
        console.error('PDF rendering failed:', err);
      }
      setPageRendering(false);
    }
  }, []);

  // 4. Page change trigger (renders page, updates progress)
  useEffect(() => {
    if (pdfLoading) return;
    renderPage(currentPage);
    api.updateProgress(record.id, currentPage - 1).catch(() => {});
  }, [currentPage, pdfLoading, renderPage, record.id]);

  // 5. Navigation event handlers
  const handlePrevPage = useCallback(() => {
    const pdf = pdfDocRef.current;
    if (!pdf) return;
    setCurrentPage(clampPdfPage(currentPage - 1, pdf.numPages));
  }, [currentPage, setCurrentPage]);

  const handleNextPage = useCallback(() => {
    const pdf = pdfDocRef.current;
    if (!pdf) return;
    setCurrentPage(clampPdfPage(currentPage + 1, pdf.numPages));
  }, [currentPage, setCurrentPage]);

  // Keypress event handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!pdfDocRef.current) return;
      const action = pdfKeyboardAction(e.key, (e.target as HTMLElement | null)?.tagName);
      if (!action) return;
      e.preventDefault();
      if (action === 'next') handleNextPage();
      else handlePrevPage();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevPage, handleNextPage]);

  // Tap-zone inside canvas wrapper. Side taps turn the page and stop bubbling;
  // center taps fall through to ReaderPage, which toggles the immersive chrome.
  const handleCanvasClick = (e: React.MouseEvent) => {
    const wrap = containerRef.current;
    if (!wrap) return;
    const action = pdfTapAction(e.clientX, wrap.clientWidth);
    if (!action) return;
    e.stopPropagation();
    if (action === 'prev') handlePrevPage();
    else handleNextPage();
  };

  // Swipes inside canvas wrapper
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    const action = pdfSwipeAction(dx);
    if (action === 'next') handleNextPage();
    else if (action === 'prev') handlePrevPage();
  };

  // 6. Log history opened/closed
  useEffect(() => {
    api.logHistory(record.id, 'opened', initialPage - 1).catch(() => {});
    return () => {
      const pageNum = useReaderStore.getState().currentPage;
      api.logHistory(record.id, 'closed', pageNum - 1).catch(() => {});
    };
  }, [record.id, initialPage]);

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-zinc-400 gap-3">
        <p className="text-sm font-semibold text-red-500">{loadError}</p>
      </div>
    );
  }

  if (pdfLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-zinc-400 select-none">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm font-medium">Opening PDF...</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleCanvasClick}
      className="w-full h-full relative overflow-hidden flex items-center justify-center bg-zinc-950/40 p-4"
    >
      <div className="relative max-h-full max-w-full flex items-center justify-center shadow-2xl rounded overflow-hidden select-none border border-zinc-800 bg-[#141414]">
        <canvas
          ref={canvasRef}
          id="pdf-canvas"
          className={cn(
            "object-contain select-none transition-opacity duration-150",
            pageRendering ? "opacity-40" : "opacity-100"
          )}
        />
        {pageRendering && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/10">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
          </div>
        )}
      </div>
    </div>
  );
}
