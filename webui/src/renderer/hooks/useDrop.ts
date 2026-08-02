import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { gatherFromDrop } from '@/lib/dropUtils';
import { showToast } from '@/hooks/useToast';

interface UseDropProps {
  onFilesDropped: (files: { file: File; relPath: string }[]) => void;
}

export function useDrop({ onFilesDropped }: UseDropProps) {
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  // Check admin status before enabling drag-to-upload.
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
  });

  const isAdmin = session?.user?.isAdmin === true;

  useEffect(() => {
    // Always suppress the browser's default window-level drop handling: without
    // preventDefault on dragover + drop, dropping a file navigates the tab to
    // that file:// URL and blows away the SPA. The upload overlay and actual
    // handling are still admin-only — non-admins just get a harmless no-op.
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (!isAdmin) return;
      dragCounter.current++;
      setDragging(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (!isAdmin) return;
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (isAdmin && e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragging(false);

      if (!isAdmin || !e.dataTransfer) return;

      try {
        const items = await gatherFromDrop(e.dataTransfer);
        if (items.length === 0) {
          showToast('No supported files in drop (.cbz, .cbr, .epub, .pdf, .mobi)');
          return;
        }
        onFilesDropped(items);
      } catch (err) {
        showToast(errorMessage(err, 'Drop failed'));
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [isAdmin, onFilesDropped]);

  return { dragging };
}
