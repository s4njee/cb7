import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { showToast } from '@/hooks/useToast';
import AddPathFailureReport, { type AddPathFailureReportData } from './AddPathFailureReport';
import {
  AddPathActions,
  AddPathErrorMessage,
  AddPathFolderInput,
  AddPathHeader,
  AddPathInput,
  AddPathScanProgress,
  UseFolderSeriesOption,
  type AddPathScanProgress as AddPathScanProgressState,
  type AddPathSuggestionItem,
} from './AddPathPanelSections';
import {
  ingestPhaseLabel,
  ingestProgressPercent,
} from './addPathPanelHelpers';

interface AddPathPanelProps {
  onSuccess: () => void;
  onBack: () => void;
}

export default function AddPathPanel({ onSuccess, onBack }: AddPathPanelProps) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState('');
  const [folder, setFolder] = useState('');
  const [useFolderSeries, setUseFolderSeries] = useState(false);
  const [folders, setFolders] = useState<api.Folder[]>([]);
  const [suggestions, setSuggestions] = useState<AddPathSuggestionItem[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<AddPathScanProgressState>({
    phase: '',
    processed: 0,
    discovered: 0,
    currentFile: '',
  });

  // Failures report state
  const [failureReport, setFailureReport] = useState<AddPathFailureReportData | null>(null);

  const fetchSeqRef = useRef(0);
  const suggestionListRef = useRef<HTMLUListElement>(null);

  // Fetch initial home path & folder suggestions
  useEffect(() => {
    api.fetchFolders()
      .then(setFolders)
      .catch(() => {});

    api.adminHostInfo()
      .then(({ homePath }) => {
        if (homePath) {
          setPath(homePath);
          fetchSuggestions(homePath);
        }
      })
      .catch(() => {});
  }, []);

  const fetchSuggestions = async (val: string) => {
    if (!val) {
      setSuggestions([]);
      return;
    }
    const mySeq = ++fetchSeqRef.current;
    try {
      const resp = await api.adminListDir(val);
      if (mySeq !== fetchSeqRef.current) return;
      setSuggestions(resp.entries);
      setShowSuggestions(resp.entries.length > 0);
    } catch {
      if (mySeq === fetchSeqRef.current) {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }
  };

  const handlePathChange = (val: string) => {
    setPath(val);
    fetchSuggestions(val);
  };

  const applySuggestion = (item: AddPathSuggestionItem) => {
    setPath(item.path);
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
    if (item.isDir) {
      fetchSuggestions(item.path);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Tab' || (e.key === 'Enter' && highlightedIndex >= 0)) {
      e.preventDefault();
      const index = highlightedIndex >= 0 ? highlightedIndex : 0;
      applySuggestion(suggestions[index]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setHighlightedIndex(-1);
    }

    // Scroll active item into view
    setTimeout(() => {
      const activeEl = suggestionListRef.current?.querySelector('.is-active');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }, 10);
  };

  const handleBlur = () => {
    setTimeout(() => {
      setShowSuggestions(false);
      setHighlightedIndex(-1);
    }, 150);
  };

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFailureReport(null);

    const trimmedPath = path.trim();
    if (!trimmedPath) return;

    setScanning(true);
    setScanProgress({
      phase: 'Starting…',
      processed: 0,
      discovered: 0,
      currentFile: '',
    });

    try {
      const folderName = folder.trim();
      const result = await api.adminAddPath(
        trimmedPath,
        (msg) => {
          setScanProgress({
            phase: ingestPhaseLabel(msg.phase),
            processed: msg.processed,
            discovered: msg.discovered,
            currentFile: msg.currentFile || '',
          });
        },
        { folderName, useFolderNamesAsSeries: useFolderSeries }
      );

      await invalidateLibraryQueries(queryClient);

      const failureTotal = result.failuresSummary?.total ?? 0;
      if (failureTotal > 0) {
        setFailureReport({
          added: result.added,
          failuresSummary: result.failuresSummary,
        });
        setScanning(false);
        return;
      }

      const msg = result.added > 0
        ? `Added ${result.added.toLocaleString()} item${result.added === 1 ? '' : 's'}`
        : 'No new items found';
      showToast(msg);
      onSuccess();
    } catch (err) {
      setErrorMsg(errorMessage(err, 'Failed to add path'));
      setScanning(false);
    }
  };

  const handleClearIngestErrors = async () => {
    try {
      await api.adminClearIngestErrors();
      showToast('Ingest error log cleared');
      // Update/reset failure report
      setFailureReport(null);
      onSuccess();
    } catch (err) {
      showToast(errorMessage(err, 'Failed to clear log'));
    }
  };

  // Render failure report view if errors occurred
  if (failureReport) {
    return (
      <AddPathFailureReport
        report={failureReport}
        onClearLog={handleClearIngestErrors}
        onClose={onSuccess}
      />
    );
  }

  const pct = ingestProgressPercent(scanProgress.processed, scanProgress.discovered);

  return (
    <div className="space-y-4">
      <AddPathHeader scanning={scanning} onBack={onBack} />

      <p className="text-xs text-muted-foreground text-left">
        Enter a file or directory path on the server host. Files are indexed in place.
      </p>

      <form onSubmit={handleScanSubmit} className="space-y-3" autoComplete="off">
        <AddPathInput
          path={path}
          scanning={scanning}
          showSuggestions={showSuggestions}
          suggestions={suggestions}
          highlightedIndex={highlightedIndex}
          suggestionListRef={suggestionListRef}
          onPathChange={handlePathChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={() => {
            if (path) setShowSuggestions(true);
          }}
          onApplySuggestion={applySuggestion}
        />

        <AddPathFolderInput
          folder={folder}
          folders={folders}
          scanning={scanning}
          onFolderChange={setFolder}
        />

        <UseFolderSeriesOption
          checked={useFolderSeries}
          scanning={scanning}
          onChange={setUseFolderSeries}
        />

        {errorMsg && (
          <AddPathErrorMessage message={errorMsg} />
        )}

        {scanning && (
          <AddPathScanProgress progress={scanProgress} percent={pct} />
        )}

        <AddPathActions scanning={scanning} canSubmit={!scanning && Boolean(path.trim())} onBack={onBack} />
      </form>
    </div>
  );
}
