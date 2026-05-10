import { Navigate, Outlet } from 'react-router';
import { FollowupNotificationManager } from '../app/components/followup/FollowupNotificationManager';
import { useAuth } from './AuthContext';

/** True when Vite env has Supabase client credentials (login UI can work). */
export function isSupabaseEnvConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return Boolean(url && anon);
}

/**
 * When Supabase URL + anon key are set, all app routes (except /login and /register) require a session.
 * Leave both unset for local file-backed / persona-only mode without auth.
 */
export function RequireAuthLayout() {
  const { session, loading } = useAuth();

  if (!isSupabaseEnvConfigured()) {
    return (
      <>
        <FollowupNotificationManager />
        <Outlet />
      </>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        Loading…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <FollowupNotificationManager />
      <Outlet />
    </>
  );
}
