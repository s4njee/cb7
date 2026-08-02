import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import LoginPanel from '@/components/admin/LoginPanel';
import ForgotPasswordPanel from '@/components/admin/ForgotPasswordPanel';

/**
 * Standalone sign-in page. Wraps the existing LoginPanel in a centered card and
 * swaps to the forgot-password notice in the same frame. Already-authenticated
 * visitors are bounced back to the library.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<'login' | 'forgot'>('login');

  const { data: session, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
  });

  if (isLoading) return null;
  if (session?.authenticated) return <Navigate to="/" replace />;

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4 py-8">
      <div className="w-full max-w-sm bg-card border border-border rounded-lg p-6 shadow-lg">
        {view === 'login' ? (
          <LoginPanel
            onNavigate={() => setView('forgot')}
            onSuccess={() => navigate('/')}
            onBack={() => navigate('/')}
          />
        ) : (
          <ForgotPasswordPanel onBack={() => setView('login')} />
        )}
      </div>
    </div>
  );
}
