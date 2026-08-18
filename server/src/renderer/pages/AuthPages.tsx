import React, { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import ResetPasswordPanel from '@/components/admin/ResetPasswordPanel';
import { showToast } from '@/hooks/useToast';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4 py-8">
      <div className="w-full max-w-sm bg-card border border-border rounded-lg p-6 shadow-lg">
        <ResetPasswordPanel
          token={token}
          onSuccess={() => navigate('/')}
          onCancel={() => navigate('/')}
        />
      </div>
    </div>
  );
}

export function VerifiedPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    showToast('Email verified — you are signed in.');
    queryClient.invalidateQueries({ queryKey: ['session'] }).then(() => {
      navigate('/', { replace: true });
    });
  }, [navigate, queryClient]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Email Verified</h2>
        <p className="text-muted-foreground text-sm">Redirecting to your library...</p>
      </div>
    </div>
  );
}
