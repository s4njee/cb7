import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import SettingsPanel from '@/components/admin/SettingsPanel';

/**
 * Standalone settings page. Wraps the existing SettingsPanel; requires a
 * signed-in session (unauthenticated visitors are sent to the sign-in page).
 */
export default function SettingsPage() {
  const navigate = useNavigate();

  const { data: session, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
  });

  if (isLoading) return null;
  if (!session?.authenticated) return <Navigate to="/login" replace />;

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8">
      <SettingsPanel onBack={() => navigate('/')} onClose={() => navigate('/')} />
    </div>
  );
}
