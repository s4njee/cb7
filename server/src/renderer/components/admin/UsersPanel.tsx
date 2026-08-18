import type { FormEvent } from 'react';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { showToast } from '@/hooks/useToast';
import {
  AddUserSection,
  UsersListSection,
  UsersPanelFooter,
  UsersPanelHeader,
} from './UsersPanelSections';
import {
  nextAdminRole,
  validateCreateUser,
  type CreateUserInput,
} from './usersPanelHelpers';

interface UsersPanelProps {
  onBack: () => void;
}

export default function UsersPanel({ onBack }: UsersPanelProps) {
  const queryClient = useQueryClient();
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [addingUser, setAddingUser] = useState(false);

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
  });
  const isAdmin = session?.user?.isAdmin === true;

  const { data: users = [], isLoading, refetch } = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
    enabled: isAdmin,
  });

  const createUserMutation = useMutation({
    mutationFn: ({ username, password }: CreateUserInput) => api.createUser(username, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      showToast('User created successfully');
      setNewUsername('');
      setNewPassword('');
      setAddingUser(false);
    },
    onError: (err) => {
      showToast(errorMessage(err, 'Failed to create user'));
    },
  });

  const setRoleMutation = useMutation({
    mutationFn: ({ id, isAdmin }: { id: number; isAdmin: boolean }) => api.setUserRole(id, isAdmin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      showToast('User role updated');
    },
    onError: (err) => {
      showToast(errorMessage(err, 'Failed to update user role'));
      refetch(); // Rollback local UI switch state
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: number) => api.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      showToast('User deleted successfully');
    },
    onError: (err) => {
      showToast(errorMessage(err, 'Failed to delete user'));
    },
  });

  const handleCreateUser = (event: FormEvent) => {
    event.preventDefault();
    const validation = validateCreateUser(newUsername, newPassword);
    if (!validation.ok) {
      showToast(validation.message);
      return;
    }
    createUserMutation.mutate(validation.input);
  };

  const handleToggleAdmin = (user: api.UserRecord) => {
    setRoleMutation.mutate({ id: user.id, isAdmin: nextAdminRole(user.isAdmin) });
  };

  const handleDeleteUser = (user: api.UserRecord) => {
    if (session?.user?.id === user.id) {
      showToast('Cannot delete yourself.');
      return;
    }
    const confirmed = window.confirm(`Are you sure you want to delete user "${user.username}"?`);
    if (confirmed) {
      deleteUserMutation.mutate(user.id);
    }
  };

  if (sessionLoading) {
    return (
      <div className="space-y-4">
        <UsersPanelHeader onBack={onBack} />
        <div className="p-4 text-sm text-muted-foreground text-center">Loading...</div>
        <UsersPanelFooter onBack={onBack} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <UsersPanelHeader onBack={onBack} />
        <div className="p-4 text-sm text-muted-foreground text-center">Admin access required.</div>
        <UsersPanelFooter onBack={onBack} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <UsersPanelHeader onBack={onBack} />

      <AddUserSection
        addingUser={addingUser}
        username={newUsername}
        password={newPassword}
        isCreating={createUserMutation.isPending}
        onStartAdding={() => setAddingUser(true)}
        onCancel={() => setAddingUser(false)}
        onUsernameChange={setNewUsername}
        onPasswordChange={setNewPassword}
        onSubmit={handleCreateUser}
      />

      <UsersListSection
        users={users}
        isLoading={isLoading}
        sessionUserId={session?.user?.id}
        roleUpdatePending={setRoleMutation.isPending}
        deletePending={deleteUserMutation.isPending}
        onToggleAdmin={handleToggleAdmin}
        onDeleteUser={handleDeleteUser}
      />

      <UsersPanelFooter onBack={onBack} />
    </div>
  );
}
