import type { FormEvent } from 'react';
import { ArrowLeft, Trash2, UserPlus } from 'lucide-react';
import type * as api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { isSelfUser } from './usersPanelHelpers';

/**
 * @module
 * User-Management Panel Section Components
 *
 * Architecture overview for Junior Devs:
 * The user-management panel is broken into small presentational React components:
 * a header, the add-user control/form, the user list, and a footer. These are
 * "dumb" — they render UI and call the callbacks passed via props; all state and
 * data fetching live in the parent UsersPanel, and the validation/self-user rules
 * live in `usersPanelHelpers`. The list uses `isSelfUser` to mark the current
 * account and disable role/delete controls on it (so an admin can't lock
 * themselves out).
 */

/**
 * Panel header with a back button and title.
 * - **onBack:** Called when the back button is clicked.
 */
export function UsersPanelHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onBack}
        className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <h2 className="text-xl font-bold tracking-tight text-foreground text-left">User Management</h2>
    </div>
  );
}

interface AddUserSectionProps {
  addingUser: boolean;
  username: string;
  password: string;
  isCreating: boolean;
  onStartAdding: () => void;
  onCancel: () => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

/**
 * Add-user control that expands into a username/password form.
 * Renders a single "Add new user" button until `addingUser` is true, then
 *          shows the inline create form. Stateless — all field values and handlers
 *          come from props.
 * - **addingUser:** Whether the form is expanded.
 * - **username:** The username field value.
 * - **password:** The password field value.
 * - **isCreating:** Whether a create request is in flight (disables submit).
 * - **onStartAdding:** Called to expand the form.
 * - **onCancel:** Called to collapse the form.
 * - **onUsernameChange:** Called with the new username as the user types.
 * - **onPasswordChange:** Called with the new password as the user types.
 * - **onSubmit:** Called when the form is submitted.
 */
export function AddUserSection({
  addingUser,
  username,
  password,
  isCreating,
  onStartAdding,
  onCancel,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: AddUserSectionProps) {
  if (!addingUser) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full border-border text-foreground hover:bg-muted"
        onClick={onStartAdding}
      >
        <UserPlus className="h-4 w-4 mr-2 text-primary" />
        Add new user
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="bg-secondary/20 border border-border p-3 rounded-lg space-y-3 text-left">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Add User</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="new-username" className="text-xs text-foreground">Username</Label>
          <Input
            id="new-username"
            type="text"
            className="h-8 bg-secondary border-border text-xs"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-pass" className="text-xs text-foreground">Password</Label>
          <Input
            id="new-pass"
            type="password"
            className="h-8 bg-secondary border-border text-xs"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            required
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground hover:text-foreground"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          disabled={isCreating}
        >
          Create
        </Button>
      </div>
    </form>
  );
}

interface UsersListSectionProps {
  users: api.UserRecord[];
  isLoading: boolean;
  sessionUserId: number | null | undefined;
  roleUpdatePending: boolean;
  deletePending: boolean;
  onToggleAdmin: (user: api.UserRecord) => void;
  onDeleteUser: (user: api.UserRecord) => void;
}

/**
 * Scrollable list of users with admin-role toggles and delete buttons.
 * Shows loading/empty states; otherwise one row per user. The signed-in
 *          user is badged "You" and has their role/delete controls disabled (via
 *          `isSelfUser`) to prevent self-lockout. Pending flags disable controls
 *          while their requests are in flight.
 * - **users:** The users to list.
 * - **isLoading:** Whether the user list is still loading.
 * - **sessionUserId:** The signed-in user's id (for self detection).
 * - **roleUpdatePending:** Whether a role change is in flight.
 * - **deletePending:** Whether a delete is in flight.
 * - **onToggleAdmin:** Called with the user whose admin role is toggled.
 * - **onDeleteUser:** Called with the user to delete.
 */
export function UsersListSection({
  users,
  isLoading,
  sessionUserId,
  roleUpdatePending,
  deletePending,
  onToggleAdmin,
  onDeleteUser,
}: UsersListSectionProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-secondary/10">
      <ScrollArea className="h-48">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground text-center">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">No users registered</div>
        ) : (
          <div className="divide-y divide-border/60">
            {users.map((user) => {
              const isCurrentUser = isSelfUser(sessionUserId, user.id);
              return (
                <div key={user.id} className="flex items-center justify-between p-3 text-left">
                  <div className="space-y-0.5 max-w-[60%]">
                    <div className="text-sm font-semibold truncate text-foreground" title={user.username}>
                      {user.username}
                      {isCurrentUser && (
                        <span className="ml-1.5 text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-mono">
                          You
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase font-mono">
                      ID: {user.id}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor={`role-${user.id}`} className="text-[10px] text-muted-foreground uppercase font-bold cursor-pointer">
                        Admin
                      </Label>
                      <Switch
                        id={`role-${user.id}`}
                        checked={user.isAdmin}
                        onCheckedChange={() => onToggleAdmin(user)}
                        disabled={isCurrentUser || roleUpdatePending}
                        className="data-[state=checked]:bg-primary"
                      />
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => onDeleteUser(user)}
                      disabled={isCurrentUser || deletePending}
                      aria-label={`Delete user ${user.username}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

/**
 * Panel footer with a Back button.
 * - **onBack:** Called when Back is clicked.
 */
export function UsersPanelFooter({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex justify-end pt-2 border-t border-border">
      <Button variant="outline" className="border-border text-foreground hover:bg-muted" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}
