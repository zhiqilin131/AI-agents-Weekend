import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearAllOnboardingClientState } from '../features/onboarding/onboarding';
import { registerAuthSessionBridge, setAuthAccessToken, setAuthUserId } from './authTokenBridge';

export type AuthContextValue = {
  supabase: SupabaseClient | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function createSupabaseClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
  if (!url || !anon) return null;
  return createClient(url, anon);
}

type AuthGlobalCache = typeof globalThis & {
  __fx_supabase_client__?: SupabaseClient | null;
  __fx_supabase_client_initialized__?: boolean;
};

function getSupabaseClientSingleton(): SupabaseClient | null {
  const g = globalThis as AuthGlobalCache;
  if (g.__fx_supabase_client_initialized__) {
    return g.__fx_supabase_client__ ?? null;
  }
  g.__fx_supabase_client__ = createSupabaseClient();
  g.__fx_supabase_client_initialized__ = true;
  return g.__fx_supabase_client__ ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabaseClientSingleton();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      setAuthAccessToken(null);
      setAuthUserId(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (cancelled) return;
      setSession(s);
      setAuthAccessToken(s?.access_token ?? null);
      setAuthUserId(s?.user?.id ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setAuthAccessToken(s?.access_token ?? null);
      setAuthUserId(s?.user?.id ?? null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      registerAuthSessionBridge(null);
      return;
    }
    registerAuthSessionBridge({
      resolveAccessToken: async () => {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      },
      refreshSession: async () => {
        await supabase.auth.refreshSession();
      },
    });
    return () => registerAuthSessionBridge(null);
  }, [supabase]);

  const signOut = async () => {
    clearAllOnboardingClientState(session?.user?.id);
    if (supabase) await supabase.auth.signOut();
    setAuthAccessToken(null);
    setAuthUserId(null);
    setSession(null);
  };

  const value: AuthContextValue = {
    supabase,
    session,
    loading,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    return {
      supabase: null,
      session: null,
      loading: false,
      signOut: async () => {},
    };
  }
  return ctx;
}
