import { useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import AddPathPanel from './AddPathPanel';
import UploadPanel from './UploadPanel';
import { CreateCollectionPanel, CreateFolderPanel } from './AdminCreatePanels';
import { adminPanelTitle, toAdminPanel } from './adminPanelHelpers';

interface AdminModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPanel: string | null;
  droppedFiles?: { file: File; relPath: string }[];
}

export default function AdminModal({ open, onOpenChange, initialPanel, droppedFiles }: AdminModalProps) {
  const requestedPanel = toAdminPanel(initialPanel);

  // Verify auth session
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
    staleTime: 30_000,
  });

  const isAdmin = session?.user?.isAdmin === true;

  // Defensive gate: every opener is already admin-gated, but the panels all hit
  // requireAdmin routes, so render nothing for non-admin sessions.
  const activePanel = isAdmin ? requestedPanel : null;

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open && activePanel !== null} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-sm rounded-lg overflow-hidden max-h-[90vh] overflow-y-auto">
        <DialogHeader className="sr-only">
          <DialogTitle className="text-foreground text-left">
            {activePanel ? adminPanelTitle(activePanel) : ''}
          </DialogTitle>
        </DialogHeader>

        {/* min-w-0: this is a CSS grid item (DialogContent is `grid`); without it
            the track's min-content equals the widest unbreakable string (a long
            filename in the upload/add-path panels), which forces the whole modal
            past its max-width and clips it on the right. */}
        <div className="py-2 min-w-0">
          {activePanel === 'add-path' && (
            <AddPathPanel
              onSuccess={handleClose}
              onBack={handleClose}
            />
          )}

          {activePanel === 'upload' && (
            <UploadPanel
              initialFiles={droppedFiles}
              onSuccess={handleClose}
              onBack={handleClose}
            />
          )}

          {activePanel === 'create-collection' && (
            <CreateCollectionPanel
              onSuccess={handleClose}
              onCancel={handleClose}
            />
          )}

          {activePanel === 'create-folder' && (
            <CreateFolderPanel
              onSuccess={handleClose}
              onCancel={handleClose}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
