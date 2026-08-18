import { Pencil, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * @module
 * Collection Header Action Buttons
 *
 * Architecture overview for Junior Devs:
 * This is a small presentational component for the action buttons shown in a
 * collection's header — "Remove Selected" (only when items are selected), Rename,
 * and Delete. It is stateless: editing permissions, selection counts, and the
 * pending flags are passed in via props, and it reports clicks back through the
 * `on*` callbacks. The edit controls only render when `canEdit` is true, so the
 * parent decides who is allowed to modify the collection.
 */

interface EditableCollectionHeaderActionsProps {
  countLabel?: string;
  canEdit: boolean;
  selectedCount: number;
  removePending: boolean;
  renamePending: boolean;
  deletePending: boolean;
  onRemoveSelected: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * Render the collection header's edit actions (remove/rename/delete).
 * Stateless. The remove button appears only when `selectedCount > 0`, and
 *          all edit controls are hidden unless `canEdit` is true. Pending flags
 *          disable the relevant buttons while their actions are in flight.
 * - **countLabel:** Optional item-count label shown alongside the actions.
 * - **canEdit:** Whether edit controls should be shown at all.
 * - **selectedCount:** How many items are selected (gates "Remove Selected").
 * - **removePending:** Whether a remove request is in flight.
 * - **renamePending:** Whether a rename request is in flight.
 * - **deletePending:** Whether a delete request is in flight.
 * - **onRemoveSelected:** Called to remove the selected items.
 * - **onRename:** Called to rename the collection.
 * - **onDelete:** Called to delete the collection.
 * @returns The rendered header action buttons.
 */
export default function EditableCollectionHeaderActions({
  countLabel,
  canEdit,
  selectedCount,
  removePending,
  renamePending,
  deletePending,
  onRemoveSelected,
  onRename,
  onDelete,
}: EditableCollectionHeaderActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground hidden sm:block">
        {countLabel ?? ''}
      </span>
      {canEdit && (
        <>
          {selectedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRemoveSelected}
              className="h-8 border-border bg-secondary text-foreground gap-1.5"
              disabled={removePending}
            >
              <XCircle className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Remove Selected</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRename}
            className="h-8 border-border bg-secondary text-foreground gap-1.5"
            disabled={renamePending || deletePending}
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Rename</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            className="h-8 border-border bg-secondary text-destructive hover:text-destructive gap-1.5"
            disabled={renamePending || deletePending}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </>
      )}
    </div>
  );
}
