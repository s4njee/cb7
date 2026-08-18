import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { showToast } from '@/hooks/useToast';

interface LoginPanelProps {
  /** Called to switch to a related auth view (only 'forgot' exists today). */
  onNavigate: (view: 'forgot') => void;
  onSuccess: (isAdmin: boolean) => void;
  onBack: () => void;
}

export default function LoginPanel({ onNavigate, onSuccess, onBack }: LoginPanelProps) {
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedId = identifier.trim();
    if (!trimmedId || !password) {
      setErrorMsg('Please enter both username/email and password.');
      return;
    }

    setLoading(true);
    try {
      await api.login(trimmedId, password);
      // Invalidate session query to trigger React re-render across application
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      const session = await queryClient.fetchQuery({
        queryKey: ['session'],
        queryFn: api.getSession,
      });
      // Per-user catalog overlays (progress, favorites) differ from the
      // guest/previous-user view, so drop the cached library data too —
      // otherwise stale favorite/progress state lingers after sign-in.
      await invalidateLibraryQueries(queryClient);
      showToast('Signed in successfully');
      onSuccess(session.user?.isAdmin === true);
    } catch (err) {
      setErrorMsg(errorMessage(err, 'Sign-in failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold tracking-tight text-foreground text-left">Sign in</h2>
      <form onSubmit={handleSubmit} className="space-y-3" autoComplete="off">
        <div className="space-y-1">
          <Label htmlFor="login-username" className="text-foreground">Username or email</Label>
          <Input
            id="login-username"
            type="text"
            className="bg-secondary border-border"
            autoComplete="username"
            autoFocus
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="login-pass" className="text-foreground">Password</Label>
          <Input
            id="login-pass"
            type="password"
            className="bg-secondary border-border"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
            onClick={onBack}
            disabled={loading}
          >
            Back
          </Button>
          <Button type="submit" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-1.5 pt-2 border-t border-border text-xs text-center">
        <button
          type="button"
          className="text-muted-foreground hover:underline"
          onClick={() => onNavigate('forgot')}
          disabled={loading}
        >
          Forgot password?
        </button>
      </div>
    </div>
  );
}
