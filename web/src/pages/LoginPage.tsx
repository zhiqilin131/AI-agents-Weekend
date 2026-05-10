import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseEnvConfigured } from '../auth/RequireAuthLayout';

export default function LoginPage() {
  const { supabase, session, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && session) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        Loading…
      </div>
    );
  }

  if (!isSupabaseEnvConfigured()) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-violet-50/50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-8 shadow-lg">
          <h1 className="text-center text-xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-3 text-center text-sm text-slate-600 leading-relaxed">
            Authentication is not configured in this build. Add{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">VITE_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">VITE_SUPABASE_ANON_KEY</code> in Vercel
            (or <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">web/.env.local</code> locally), then redeploy
            or restart the dev server.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-6 w-full rounded-full border border-slate-200 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!supabase) {
      setError('Auth client failed to initialize.');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) {
        setError(err.message);
        return;
      }
      navigate('/', { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-violet-50/50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-8 shadow-lg">
        <h1 className="text-center text-xl font-semibold text-slate-900">Sign in</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Sign in to use Foresight-X</p>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-6 flex flex-col gap-4">
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-violet-400/50"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-violet-400/50"
            />
          </label>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-violet-600 py-2.5 text-sm font-semibold text-white shadow hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? '…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          No account?{' '}
          <Link to="/register" className="font-medium text-violet-600 hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
