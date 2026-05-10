import { Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthContext';

/** When Supabase URL is set, require login unless ``VITE_REQUIRE_AUTH=false``. */
export function supabaseGateEnabled(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  if (!url) return false;
  const v = import.meta.env.VITE_REQUIRE_AUTH?.trim().toLowerCase();
  if (v === 'false' || v === '0') return false;
  return true;
}

export function RequireAuthLayout() {
  const { session, loading } = useAuth();

  if (!supabaseGateEnabled()) {
    return <Outlet />;
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

  return <Outlet />;
}
