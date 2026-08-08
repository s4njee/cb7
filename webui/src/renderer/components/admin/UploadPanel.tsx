import React, { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { errorMessage } from '@/lib/errors';
import { showToast } from '@/hooks/useToast';
import { gatherFromDrop } from '@/lib/dropUtils';
import {
  UploadActions,
  UploadDropZone,
  UploadErrorMessage,
  UploadOverallProgress,
  UploadPanelHeader,
  UploadQueueList,
  UploadQueueSummary,
} from './UploadPanelSections';
import {
  appendAcceptedUploadItems,
  hasUploadableItems,
  overallUploadProgressPercent,
  totalUploadBytes,
  uploadPrimaryLabel,
  uploadQueueSummary,
  type UploadQueueItem,
} from './uploadPanelHelpers';

interface UploadPanelProps {
  initialFiles?: { file: File; relPath: string }[];
  onSuccess: () => void;
  onBack: () => void;
}

type QueueItem = UploadQueueItem & {
  file: File;
};

export default function UploadPanel({ initialFiles, onSuccess, onBack }: UploadPanelProps) {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<QueueItem[]>([]);

  // Load initial dropped files on mount
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      addFiles(initialFiles);
    }
  }, [initialFiles]);

  // Abort any in-flight upload when the dialog closes. The admin modal unmounts
  // this panel on every close path (back / close / success / X), so the cleanup
  // is the single hook that stops the transfer.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [overallPhase, setOverallPhase] = useState('');
  const [overallProgress, setOverallProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // The controller for the in-progress upload, aborted by the unmount cleanup
  // above when the dialog is dismissed mid-transfer.
  const abortRef = useRef<AbortController | null>(null);

  const addFiles = (items: { file: File; relPath: string }[]) => {
    setErrorMsg(null);
    setQueue((prev) => appendAcceptedUploadItems(prev, items) as QueueItem[]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    try {
      const items = await gatherFromDrop(e.dataTransfer);
      if (items.length === 0) {
        setErrorMsg('No supported files in drop (.cbz, .cbr, .epub, .pdf, .mobi)');
      } else {
        addFiles(items);
      }
    } catch (err) {
      setErrorMsg(errorMessage(err, 'Failed to read dropped files'));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const items = Array.from(e.target.files).map((file) => ({ file, relPath: file.name }));
    addFiles(items);
    e.target.value = '';
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const items = Array.from(e.target.files).map((file) => ({
      file,
      relPath: file.webkitRelativePath || file.name,
    }));
    addFiles(items);
    e.target.value = '';
  };

  const startUpload = async () => {
    if (uploading || queue.length === 0) return;
    setUploading(true);
    setErrorMsg(null);

    const controller = new AbortController();
    abortRef.current = controller;

    let addedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Use snapshot of current queue
    const currentQueue = [...queue];
    const totalBytes = totalUploadBytes(currentQueue);
    let completedBytes = 0;

    for (let i = 0; i < currentQueue.length; i++) {
      const item = currentQueue[i];
      if (item.status === 'done' || item.status === 'skipped') {
        completedBytes += item.file.size;
        continue;
      }

      // Update active item state
      setQueue((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: 'uploading', loaded: 0 };
        return next;
      });

      setOverallPhase(`Uploading ${i + 1} of ${currentQueue.length} — ${item.relPath}`);
      setOverallProgress(overallUploadProgressPercent(completedBytes, 0, totalBytes));

      try {
        const result = await api.adminUploadFile(item.file, item.relPath, ({ loaded, phase }) => {
          const clamped = Math.min(item.file.size, Math.max(0, loaded));
          setQueue((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], loaded: clamped, status: 'uploading' };
            return next;
          });
          setOverallProgress(overallUploadProgressPercent(completedBytes, clamped, totalBytes));
          if (phase === 'processing') {
            setOverallPhase(`Processing ${i + 1} of ${currentQueue.length} — ${item.relPath}`);
          } else {
            setOverallPhase(`Uploading ${i + 1} of ${currentQueue.length} — ${item.relPath}`);
          }
        }, controller.signal);

        // Set status to done or skipped
        const finalStatus = (result.skipped || !result.added) ? 'skipped' : 'done';
        if (finalStatus === 'done') addedCount++;
        else skippedCount++;

        completedBytes += item.file.size;
        setQueue((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: finalStatus, loaded: item.file.size };
          return next;
        });
        setOverallProgress(overallUploadProgressPercent(completedBytes, 0, totalBytes));
      } catch (err) {
        // The dialog closed mid-transfer — stop the queue and skip the success
        // summary so a cancelled upload isn't reported as done.
        if (controller.signal.aborted) {
          setUploading(false);
          abortRef.current = null;
          return;
        }
        failedCount++;
        // Count failed bytes as done for overall progress so the bar still moves.
        completedBytes += item.file.size;
        setQueue((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'error', error: errorMessage(err, 'Upload failed') };
          return next;
        });
        setOverallProgress(overallUploadProgressPercent(completedBytes, 0, totalBytes));
      }
    }

    abortRef.current = null;
    setOverallProgress(100);
    setOverallPhase(`Done — ${addedCount} added, ${skippedCount} skipped, ${failedCount} failed`);
    setUploading(false);

    if (addedCount > 0) {
      showToast(`Added ${addedCount} item${addedCount === 1 ? '' : 's'}`);
      await invalidateLibraryQueries(queryClient);
    }

    if (failedCount === 0) {
      setTimeout(onSuccess, 1000);
    }
  };

  const queueSummary = uploadQueueSummary(queue);
  const primaryLabel = uploadPrimaryLabel(queue);

  return (
    <div className="space-y-4">
      <UploadPanelHeader uploading={uploading} onBack={onBack} />

      <p className="text-xs text-muted-foreground text-left">
        Drop files or folders here. Supported: .cbz .cbr .epub .pdf .mobi
      </p>

      <UploadDropZone
        dragOver={dragOver}
        uploading={uploading}
        fileInputRef={fileInputRef}
        folderInputRef={folderInputRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onFileChange={handleFileChange}
        onFolderChange={handleFolderChange}
        onPickFiles={() => fileInputRef.current?.click()}
        onPickFolder={() => folderInputRef.current?.click()}
      />

      {queue.length > 0 && (
        <UploadQueueSummary countLabel={queueSummary.countLabel} bytesLabel={queueSummary.bytesLabel} />
      )}

      {(uploading || overallPhase) && (
        <UploadOverallProgress phase={overallPhase} progress={overallProgress} />
      )}

      {queue.length > 0 && (
        <UploadQueueList queue={queue} />
      )}

      {errorMsg && (
        <UploadErrorMessage message={errorMsg} />
      )}

      <UploadActions
        uploading={uploading}
        disabled={uploading || queue.length === 0}
        primaryLabel={primaryLabel}
        onBack={onBack}
        onPrimaryAction={hasUploadableItems(queue) ? startUpload : onSuccess}
      />
    </div>
  );
}
