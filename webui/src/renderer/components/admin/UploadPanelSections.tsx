import type { ChangeEvent, DragEvent, Ref } from 'react';
import { ArrowLeft, FileUp, FolderUp, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ACCEPT_ATTR, formatBytes } from '@/lib/dropUtils';
import {
  uploadRowStatus,
  type UploadQueueItem,
} from './uploadPanelHelpers';

/**
 * @module
 * Upload Panel Section Components
 *
 * Architecture overview for Junior Devs:
 * Like the settings panel, the upload panel is broken into small presentational
 * React components — one per visual block (header, drop zone, queue summary,
 * progress bar, queue list, error message, action buttons). These are "dumb":
 * they render UI and call the callbacks passed in via props; all queue state and
 * upload logic live in the parent UploadPanel, and the queue/display rules live in
 * `uploadPanelHelpers`. This keeps the parent readable and each block reusable.
 */

/**
 * Panel header with a back button and title.
 * - **uploading:** Whether an upload is in progress (disables back).
 * - **onBack:** Called when the back button is clicked.
 */
export function UploadPanelHeader({
  uploading,
  onBack,
}: {
  uploading: boolean;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onBack}
        disabled={uploading}
        className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition disabled:opacity-50"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <h2 className="text-xl font-bold tracking-tight text-foreground text-left">Upload comics</h2>
    </div>
  );
}

interface UploadDropZoneProps {
  dragOver: boolean;
  uploading: boolean;
  fileInputRef: Ref<HTMLInputElement>;
  folderInputRef: Ref<HTMLInputElement>;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFolderChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPickFiles: () => void;
  onPickFolder: () => void;
}

/**
 * Drag-and-drop target with "pick files" / "pick folder" buttons.
 * Hosts hidden file inputs (one multiple-file, one directory) wired to
 *          the provided refs; clicking the zone or buttons triggers the matching
 *          picker callback. Highlights while a drag is hovering.
 * - **dragOver:** Whether a drag is currently over the zone (for styling).
 * - **uploading:** Whether an upload is in progress (disables buttons).
 * - **fileInputRef:** Ref for the hidden multiple-file input.
 * - **folderInputRef:** Ref for the hidden directory input.
 * - **onDragOver:** Drag-over handler.
 * - **onDragLeave:** Drag-leave handler.
 * - **onDrop:** Drop handler.
 * - **onFileChange:** Change handler for the file input.
 * - **onFolderChange:** Change handler for the folder input.
 * - **onPickFiles:** Opens the file picker.
 * - **onPickFolder:** Opens the folder picker.
 */
export function UploadDropZone({
  dragOver,
  uploading,
  fileInputRef,
  folderInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
  onFolderChange,
  onPickFiles,
  onPickFolder,
}: UploadDropZoneProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 transition cursor-pointer ${
        dragOver ? 'border-primary bg-primary/5' : 'border-border bg-secondary/20 hover:bg-secondary/40'
      }`}
      onClick={onPickFiles}
    >
      <Upload className={`h-8 w-8 transition ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
      <span className="text-sm font-semibold text-foreground">Drop files or folders</span>
      <span className="text-xs text-muted-foreground">or</span>
      <div className="flex gap-2 mt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-border text-foreground hover:bg-muted"
          onClick={(event) => {
            event.stopPropagation();
            onPickFiles();
          }}
          disabled={uploading}
        >
          <FileUp className="h-4 w-4 mr-1 text-primary" />
          Files...
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-border text-foreground hover:bg-muted"
          onClick={(event) => {
            event.stopPropagation();
            onPickFolder();
          }}
          disabled={uploading}
        >
          <FolderUp className="h-4 w-4 mr-1 text-primary" />
          Folder...
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept={ACCEPT_ATTR}
        onChange={onFileChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={onFolderChange}
        {...{ webkitdirectory: '', directory: '' }}
      />
    </div>
  );
}

/**
 * One-line summary of the queued files (count and total size).
 * - **countLabel:** The pre-formatted file-count label.
 * - **bytesLabel:** The pre-formatted total-size label.
 */
export function UploadQueueSummary({
  countLabel,
  bytesLabel,
}: {
  countLabel: string;
  bytesLabel: string;
}) {
  return (
    <div className="flex justify-between items-center text-xs font-semibold text-muted-foreground px-1 text-left">
      <span>{countLabel}</span>
      <span>{bytesLabel}</span>
    </div>
  );
}

/**
 * Overall upload progress bar with a phase label.
 * - **phase:** Text describing the current phase.
 * - **progress:** Completion percentage (0–100).
 */
export function UploadOverallProgress({
  phase,
  progress,
}: {
  phase: string;
  progress: number;
}) {
  return (
    <div className="bg-secondary/40 border border-border p-3 rounded-lg space-y-1.5 text-left">
      <div className="text-xs font-semibold text-foreground truncate">{phase}</div>
      <Progress value={progress} className="h-1.5 bg-muted" />
    </div>
  );
}

/**
 * Scrollable list of queued files, each with size and per-item status.
 * Derives each row's text/colour/percent via `uploadRowStatus`, showing
 *          an inline progress bar only while that item is uploading.
 * - **queue:** The upload queue to render.
 */
export function UploadQueueList({ queue }: { queue: UploadQueueItem[] }) {
  return (
    <div className="h-44 overflow-y-auto border border-border rounded-lg bg-secondary/10 p-2">
      <div className="space-y-2">
        {queue.map((item, idx) => {
          const rowStatus = uploadRowStatus(item);

          return (
            <div key={idx} className="text-left border-b border-border/40 pb-2 last:border-0 last:pb-0 min-w-0">
              <div className="flex justify-between gap-2 text-xs font-semibold min-w-0">
                <span className="truncate min-w-0 text-foreground" title={item.relPath}>
                  {item.relPath}
                </span>
                <span className="text-muted-foreground shrink-0">{formatBytes(item.file.size)}</span>
              </div>
              {item.status === 'uploading' && (
                <Progress value={rowStatus.percent} className="h-1 bg-muted my-1" />
              )}
              <div className={`text-[10px] ${rowStatus.className} mt-0.5`}>{rowStatus.text}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Styled error banner for upload failures.
 * - **message:** The error text to display.
 */
export function UploadErrorMessage({ message }: { message: string }) {
  return (
    <div className="text-destructive text-xs font-semibold leading-relaxed bg-destructive/10 p-2.5 rounded border border-destructive/20 text-left">
      {message}
    </div>
  );
}

/**
 * Footer action buttons: Back and the primary Upload/Done action.
 * - **uploading:** Whether an upload is in progress (disables Back).
 * - **disabled:** Whether the primary action is disabled.
 * - **primaryLabel:** The primary button label (`'Upload'` or `'Done'`).
 * - **onBack:** Called when Back is clicked.
 * - **onPrimaryAction:** Called when the primary button is clicked.
 */
export function UploadActions({
  uploading,
  disabled,
  primaryLabel,
  onBack,
  onPrimaryAction,
}: {
  uploading: boolean;
  disabled: boolean;
  primaryLabel: 'Upload' | 'Done';
  onBack: () => void;
  onPrimaryAction: () => void;
}) {
  return (
    <div className="flex gap-2 pt-2 justify-between border-t border-border">
      <Button
        type="button"
        variant="outline"
        className="border-border text-foreground hover:bg-muted"
        onClick={onBack}
        disabled={uploading}
      >
        Back
      </Button>
      <Button
        type="button"
        className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
        onClick={onPrimaryAction}
        disabled={disabled}
      >
        {primaryLabel}
      </Button>
    </div>
  );
}
