import type { FormEvent } from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { showToast } from '@/hooks/useToast';

/**
 * @module
 * Admin "Create" Form Panels
 *
 * Architecture overview for Junior Devs:
 * These two panels let an admin create a new collection or a new folder. Unlike
 * the purely presentational section components elsewhere in the admin area, these
 * are self-contained: each owns its own form state (via `useState`) and performs
 * the create request with a React Query `useMutation`. On success they invalidate
 * the relevant query cache (so lists refresh), show a toast, and call `onSuccess`;
 * on failure they surface the error via a toast. The parent only needs to provide
 * `onSuccess` / `onCancel` to react to the panel finishing.
 */

interface CreateCollectionPanelProps {
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Form panel for creating a new collection (a comic or book library).
 * Owns the name and media-type fields and the create mutation. On success
 *          it refreshes the `libraries` query, toasts, and calls `onSuccess`.
 *          Submission is blocked while pending or when the name is blank.
 * - **onSuccess:** Called after the collection is created successfully.
 * - **onCancel:** Called when the user cancels.
 * @returns The rendered create-collection form.
 */
export function CreateCollectionPanel({ onSuccess, onCancel }: CreateCollectionPanelProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [mediaType, setMediaType] = useState<'comic' | 'book'>('comic');

  const mutation = useMutation({
    mutationFn: () => api.createLibrary(name.trim(), mediaType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
      showToast(`Created collection "${name.trim()}"`);
      onSuccess();
    },
    onError: (err) => {
      showToast(errorMessage(err, 'Failed to create collection'));
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      <h2 className="text-xl font-bold tracking-tight text-foreground">New collection</h2>
      <div className="space-y-1">
        <Label htmlFor="col-name" className="text-foreground">Name</Label>
        <Input
          id="col-name"
          type="text"
          className="bg-secondary border-border"
          required
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={mutation.isPending}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-foreground">Type</Label>
        <Tabs
          value={mediaType}
          onValueChange={(value) => setMediaType(value as 'comic' | 'book')}
          className="w-full"
        >
          <TabsList className="grid grid-cols-2 bg-secondary border border-border">
            <TabsTrigger value="comic" disabled={mutation.isPending}>Comics</TabsTrigger>
            <TabsTrigger value="book" disabled={mutation.isPending}>Books</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex gap-2 pt-2 justify-between border-t border-border">
        <Button
          type="button"
          variant="outline"
          className="border-border text-foreground hover:bg-muted"
          onClick={onCancel}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          disabled={mutation.isPending || !name.trim()}
        >
          {mutation.isPending ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

interface CreateFolderPanelProps {
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Form panel for creating a new (initially empty) folder.
 * Owns the name field and the create mutation. On success it refreshes the
 *          `folders` query, toasts, and calls `onSuccess`. Submission is blocked
 *          while pending or when the name is blank.
 * - **onSuccess:** Called after the folder is created successfully.
 * - **onCancel:** Called when the user cancels.
 * @returns The rendered create-folder form.
 */
export function CreateFolderPanel({ onSuccess, onCancel }: CreateFolderPanelProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.createFolder(name.trim(), []),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      showToast(`Created folder "${name.trim()}"`);
      onSuccess();
    },
    onError: (err) => {
      showToast(errorMessage(err, 'Failed to create folder'));
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      <h2 className="text-xl font-bold tracking-tight text-foreground">New folder</h2>
      <div className="space-y-1">
        <Label htmlFor="fld-name" className="text-foreground">Name</Label>
        <Input
          id="fld-name"
          type="text"
          className="bg-secondary border-border"
          required
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={mutation.isPending}
        />
      </div>
      <div className="flex gap-2 pt-2 justify-between border-t border-border">
        <Button
          type="button"
          variant="outline"
          className="border-border text-foreground hover:bg-muted"
          onClick={onCancel}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          disabled={mutation.isPending || !name.trim()}
        >
          {mutation.isPending ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
