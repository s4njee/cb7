import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { showToast } from '@/hooks/useToast';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface ResetPasswordPanelProps {
  token: string | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ResetPasswordPanel({ token, onSuccess, onCancel }: ResetPasswordPanelProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight text-foreground text-left">Reset password</h2>
        <p className="text-sm text-muted-foreground">
          The reset link is missing its token — please request a new email link.
        </p>
        <div className="flex justify-end pt-2 border-t border-border">
          <Button type="button" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword(newPassword, token);
      showToast('Password updated — please sign in.');
      onSuccess();
    } catch (err) {
      setErrorMsg(errorMessage(err, 'Password update failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold tracking-tight text-foreground text-left">Set a new password</h2>
      <form onSubmit={handleSubmit} className="space-y-3" autoComplete="off">
        <div className="space-y-1">
          <Label htmlFor="rp-password" className="text-foreground">New password</Label>
          <Input
            id="rp-password"
            type="password"
            className="bg-secondary border-border"
            autoComplete="new-password"
            required
            autoFocus
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="rp-confirm" className="text-foreground">Confirm password</Label>
          <Input
            id="rp-confirm"
            type="password"
            className="bg-secondary border-border"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        {errorMsg && (
          <div className="text-destructive text-xs font-semibold leading-relaxed bg-destructive/10 p-2.5 rounded border border-destructive/20">
            {errorMsg}
          </div>
        )}

        <div className="flex gap-2 pt-2 justify-between">
          <Button
            type="button"
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" disabled={loading}>
            {loading ? 'Updating...' : 'Update password'}
          </Button>
        </div>
      </form>
    </div>
  );
}
