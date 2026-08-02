import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import UsersPanel from '@/components/admin/UsersPanel';

/**
 * Standalone user-management page. Wraps the existing UsersPanel; admin only
 * (unauthenticated visitors go to sign-in, non-admins back to the library).
 */
export default function UsersPage() {
  const navigate = useNavigate();

  const { data: session, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
  });

  if (isLoading) return null;
  if (!session?.authenticated) return <Navigate to="/login" replace />;
  if (session.user?.isAdmin !== true) return <Navigate to="/" replace />;

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8">
      <UsersPanel onBack={() => navigate('/')} />
    </div>
  );
}
