import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { showToast } from '@/hooks/useToast';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Users } from 'lucide-react';

/**
 * Admin editor for a collection's access (P1-1): "everyone" or an explicit
 * member list. Restricting a collection hides its books from the grid, browse,
 * shelves, OPDS, and search-inside for non-members.
 */
export default function LibraryAccessDialog({
  libraryId,
  libraryName,
  open,
  onOpenChange,
}: {
  libraryId: number;
  libraryName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: access } = useQuery({
    queryKey: ['library-access', libraryId],
    queryFn: () => api.fetchLibraryAccess(libraryId),
    enabled: open,
  });
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
    enabled: open,
  });

  const [everyone, setEveryone] = useState(true);
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());

  // Sync local state whenever the fetched access changes.
  useEffect(() => {
    if (!access) return;
    setEveryone(access.everyone);
    setMemberIds(new Set(access.memberIds));
  }, [access]);

  const save = useMutation({
    mutationFn: () => api.setLibraryAccess(libraryId, { everyone, memberIds: [...memberIds] }),
    onSuccess: async () => {
      await invalidateLibraryQueries(queryClient);
      showToast('Collection access updated');
      onOpenChange(false);
    },
    onError: (err) => showToast(errorMessage(err, 'Failed to update access')),
  });

  const toggleMember = (userId: number) => {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-popover-border text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Access — {libraryName}
          </DialogTitle>
          <DialogDescription>
            Choose who can see this collection. Restricting it also hides its books from the grid, browse, shelves,
            OPDS, and search-inside for everyone else.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium text-foreground">Everyone can see</Label>
            <p className="text-xs text-muted-foreground">All users and guests (the default).</p>
          </div>
          <Switch checked={everyone} onCheckedChange={setEveryone} />
        </div>

        {!everyone && (
          <div className="max-h-56 overflow-y-auto border-t border-border pt-3 space-y-1.5">
            <p className="text-xs text-muted-foreground pb-1">Members allowed to see this collection:</p>
            {(users ?? []).map((user) => (
              <label key={user.id} className="flex items-center gap-2.5 py-1 cursor-pointer">
                <Checkbox
                  checked={memberIds.has(user.id)}
                  onCheckedChange={() => toggleMember(user.id)}
                  className="bg-card border-muted-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                />
                <span className="text-sm text-foreground">{user.username}</span>
              </label>
            ))}
            {(users ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">No accounts yet.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="border-border text-foreground hover:bg-muted" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
