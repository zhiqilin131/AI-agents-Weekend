import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseEnvConfigured } from '../auth/RequireAuthLayout';
import { AuthFormCard, AuthShell, BRAND_SUBTITLE } from '../app/components/auth/AuthShell';

const inputClass =
  'mt-1.5 w-full rounded-xl border border-gray-200/90 bg-white/85 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition-shadow placeholder:text-gray-400 focus:border-violet-300/80 focus:ring-2 focus:ring-violet-400/35';

const primaryBtnClass =
  'w-full rounded-full bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 py-3 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(99,102,241,0.35)] transition-all hover:shadow-[0_14px_40px_rgba(99,102,241,0.42)] hover:brightness-[1.03] active:scale-[0.99] disabled:opacity-50 disabled:hover:brightness-100';

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
      <AuthShell>
        <AuthFormCard title="Sign in" subtitle={null}>
          <p className="text-center text-sm text-gray-500">Loading…</p>
        </AuthFormCard>
      </AuthShell>
    );
  }

  if (!isSupabaseEnvConfigured()) {
    return (
      <AuthShell>
        <AuthFormCard title="Sign in" subtitle={null}>
          <p className="text-center text-sm leading-relaxed text-gray-600">
            Authentication is not configured in this build. Add{' '}
            <code className="rounded-md bg-violet-50 px-1.5 py-0.5 text-xs text-violet-900">VITE_SUPABASE_URL</code> and{' '}
            <code className="rounded-md bg-violet-50 px-1.5 py-0.5 text-xs text-violet-900">VITE_SUPABASE_ANON_KEY</code>{' '}
            (publishable key) in Vercel or <code className="rounded-md bg-violet-50 px-1.5 py-0.5 text-xs">web/.env.local</code>,
            then redeploy or restart the dev server.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className={`${primaryBtnClass} mt-6`}
          >
            Back to home
          </button>
        </AuthFormCard>
      </AuthShell>
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
    <AuthShell>
      <AuthFormCard
        title="Sign in"
        subtitle={BRAND_SUBTITLE}
        footer={
          <p className="text-center text-sm text-gray-600">
            No account?{' '}
            <Link to="/register" className="font-semibold text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900">
              Create one
            </Link>
          </p>
        }
      >
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 md:text-[11px]">
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 md:text-[11px]">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={inputClass}
            />
          </label>
          {error ? (
            <p className="rounded-xl border border-rose-200/80 bg-rose-50/90 px-3 py-2 text-sm text-rose-800">{error}</p>
          ) : null}
          <button type="submit" disabled={busy} className={primaryBtnClass}>
            {busy ? '…' : 'Sign in'}
          </button>
        </form>
      </AuthFormCard>
    </AuthShell>
  );
}
