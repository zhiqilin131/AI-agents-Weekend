import { Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthContext';

/** True when Vite env has Supabase client credentials (login UI can work). */
export function isSupabaseEnvConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return Boolean(url && anon);
}

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
