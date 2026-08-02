import type { KeyboardEvent, Ref } from 'react';
import { ArrowLeft, File, Folder } from 'lucide-react';
import type * as api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

/**
 * @module
 * Add-Path Panel Section Components
 *
 * Architecture overview for Junior Devs:
 * The "Add from server path" panel is split into small presentational React
 * components — one per visual block (header, path input with autocomplete, folder
 * input, the "use folder as series" option, error message, scan progress, and the
 * action buttons). These are "dumb": they render UI and call the callbacks passed
 * via props; all state (path text, suggestion list, scan progress) lives in the
 * parent AddPathPanel. Keeping the sections separate keeps the parent readable.
 */

/** A single path-autocomplete suggestion shown under the input. */
export interface AddPathSuggestionItem {
  name: string;
  path: string;
  isDir: boolean;
}

/** Live progress state for an in-flight library scan. */
export type AddPathScanProgress = {
  phase: string;
  processed: number;
  discovered: number;
  currentFile: string;
};

/**
 * Panel header with a back button and title.
 * - **scanning:** Whether a scan is in progress (disables back).
 * - **onBack:** Called when the back button is clicked.
 */
export function AddPathHeader({ scanning, onBack }: { scanning: boolean; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onBack}
        disabled={scanning}
        className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition disabled:opacity-50"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <h2 className="text-xl font-bold tracking-tight text-foreground text-left">Add from server path</h2>
    </div>
  );
}

interface AddPathInputProps {
  path: string;
  scanning: boolean;
  showSuggestions: boolean;
  suggestions: AddPathSuggestionItem[];
  highlightedIndex: number;
  suggestionListRef: Ref<HTMLUListElement>;
  onPathChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onBlur: () => void;
  onFocus: () => void;
  onApplySuggestion: (item: AddPathSuggestionItem) => void;
}

/**
 * Server-path text input with a keyboard-navigable suggestion dropdown.
 * Renders the suggestions list only when `showSuggestions` is set and
 *          there are entries; the highlighted row is driven by `highlightedIndex`.
 *          Suggestions are applied on mouse-down (before blur) so the click isn't lost.
 * - **path:** The current path text.
 * - **scanning:** Whether a scan is in progress (disables the input).
 * - **showSuggestions:** Whether to show the suggestion dropdown.
 * - **suggestions:** The autocomplete suggestions to render.
 * - **highlightedIndex:** Index of the keyboard-highlighted suggestion.
 * - **suggestionListRef:** Ref to the suggestion `<ul>` (for scroll-into-view).
 * - **onPathChange:** Called with the new path text as the user types.
 * - **onKeyDown:** Key handler driving suggestion navigation/selection.
 * - **onBlur:** Input blur handler.
 * - **onFocus:** Input focus handler.
 * - **onApplySuggestion:** Called with the chosen suggestion.
 */
export function AddPathInput({
  path,
  scanning,
  showSuggestions,
  suggestions,
  highlightedIndex,
  suggestionListRef,
  onPathChange,
  onKeyDown,
  onBlur,
  onFocus,
  onApplySuggestion,
}: AddPathInputProps) {
  return (
    <div className="space-y-1 relative">
      <Label htmlFor="admin-path" className="text-foreground">Server path</Label>
      <Input
        id="admin-path"
        type="text"
        className="bg-secondary border-border font-mono text-sm"
        placeholder="Loading host path..."
        required
        disabled={scanning}
        value={path}
        onChange={(event) => onPathChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onFocus={onFocus}
      />

      {showSuggestions && suggestions.length > 0 && (
        <ul
          ref={suggestionListRef}
          className="absolute top-full left-0 right-0 z-50 bg-card border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto mt-1 py-1"
        >
          {suggestions.map((item, index) => (
            <li
              key={index}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer select-none text-foreground hover:bg-muted ${
                index === highlightedIndex ? 'bg-muted is-active font-semibold' : ''
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                onApplySuggestion(item);
              }}
            >
              {item.isDir ? (
                <Folder className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <File className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="truncate">{item.name}{item.isDir ? '/' : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface AddPathFolderInputProps {
  folder: string;
  folders: api.Folder[];
  scanning: boolean;
  onFolderChange: (value: string) => void;
}

/**
 * Optional target-folder input with existing folders as datalist options.
 * Leaving it empty adds to the main library; typing a new name creates an
 *          empty folder. Existing folders are offered as autocomplete options.
 * - **folder:** The current folder-name text.
 * - **folders:** Existing folders offered as suggestions.
 * - **scanning:** Whether a scan is in progress (disables the input).
 * - **onFolderChange:** Called with the new folder name as the user types.
 */
export function AddPathFolderInput({
  folder,
  folders,
  scanning,
  onFolderChange,
}: AddPathFolderInputProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor="admin-folder" className="text-foreground">Folder (optional)</Label>
      <Input
        id="admin-folder"
        type="text"
        className="bg-secondary border-border"
        placeholder="Leave empty to add to main library"
        disabled={scanning}
        value={folder}
        onChange={(event) => onFolderChange(event.target.value)}
        list="admin-folder-options"
      />
      <datalist id="admin-folder-options">
        {folders.map((folderOption) => (
          <option key={folderOption.id} value={folderOption.name} />
        ))}
      </datalist>
      <p className="text-[10px] text-muted-foreground leading-normal mt-1">
        Existing folders are suggested; a new name creates an empty folder. Foldered items don't appear in the main library view.
      </p>
    </div>
  );
}

interface UseFolderSeriesOptionProps {
  checked: boolean;
  scanning: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Checkbox to use folder names as series names during the scan.
 * Turn off for omnibus folders where each archive should stand alone.
 * - **checked:** Whether the option is enabled.
 * - **scanning:** Whether a scan is in progress (disables the checkbox).
 * - **onChange:** Called with the new checked state.
 */
export function UseFolderSeriesOption({ checked, scanning, onChange }: UseFolderSeriesOptionProps) {
  return (
    <>
      <div className="flex items-center space-x-2 pt-1.5">
        <Checkbox
          id="admin-use-folder-series"
          checked={checked}
          onCheckedChange={(value) => onChange(value === true)}
          disabled={scanning}
          className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
        />
        <Label htmlFor="admin-use-folder-series" className="text-foreground cursor-pointer select-none">
          Use folder names as series
        </Label>
      </div>
      <p className="text-[10px] text-muted-foreground leading-normal ml-6 mt-[-4px]">
        Leave off for omnibus folders where each archive should stand alone.
      </p>
    </>
  );
}

/**
 * Styled error banner for add-path failures.
 * - **message:** The error text to display.
 */
export function AddPathErrorMessage({ message }: { message: string }) {
  return (
    <div className="text-destructive text-xs font-semibold leading-relaxed bg-destructive/10 p-2.5 rounded border border-destructive/20">
      {message}
    </div>
  );
}

/**
 * Live scan-progress block: phase, processed/discovered counts, current file.
 * Shows "Discovering files..." until a discovered total is known, then a
 *          running count plus a progress bar and the file currently being processed.
 * - **progress:** The current scan progress state.
 * - **percent:** The completion percentage (0–100) for the bar.
 */
export function AddPathScanProgress({
  progress,
  percent,
}: {
  progress: AddPathScanProgress;
  percent: number;
}) {
  return (
    <div className="bg-secondary/40 border border-border p-3.5 rounded-lg space-y-2 text-left animate-pulse">
      <div className="flex justify-between text-xs font-semibold">
        <span className="text-foreground">{progress.phase}</span>
        <span className="text-muted-foreground">
          {progress.discovered > 0
            ? `${progress.processed.toLocaleString()} / ${progress.discovered.toLocaleString()}`
            : 'Discovering files...'}
        </span>
      </div>
      <Progress value={percent} className="h-1.5 bg-muted" />
      {progress.currentFile && (
        <div className="text-[10px] font-mono text-muted-foreground truncate" title={progress.currentFile}>
          {progress.currentFile}
        </div>
      )}
    </div>
  );
}

/**
 * Footer action buttons: Cancel and the submit (Add/Scanning) button.
 * - **scanning:** Whether a scan is in progress (disables Cancel, sets label).
 * - **canSubmit:** Whether the submit button is enabled.
 * - **onBack:** Called when Cancel is clicked.
 */
export function AddPathActions({
  scanning,
  canSubmit,
  onBack,
}: {
  scanning: boolean;
  canSubmit: boolean;
  onBack: () => void;
}) {
  return (
    <div className="flex gap-2 pt-2 justify-between border-t border-border">
      <Button
        type="button"
        variant="outline"
        className="border-border text-foreground hover:bg-muted"
        onClick={onBack}
        disabled={scanning}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
        disabled={!canSubmit}
      >
        {scanning ? 'Scanning...' : 'Add'}
      </Button>
    </div>
  );
}
