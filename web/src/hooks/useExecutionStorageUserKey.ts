import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../utils/apiFetch';

/**
 * Stable key for partitioning execution-calendar localStorage + coach options per account.
 * Matches server `_active_user_id`: Supabase JWT sub when signed in, else persona registry id.
 */
export function useExecutionStorageUserKey(): { storageUserKey: string | null; ready: boolean } {
  const { session, loading: authLoading } = useAuth();
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [personaResolved, setPersonaResolved] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (session?.user?.id) {
      setPersonaId(null);
      setPersonaResolved(true);
      return;
    }
    let cancelled = false;
    setPersonaResolved(false);
    void apiFetch('/api/personas')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { current_user_id?: string } | null) => {
        if (cancelled || !data) return;
        const uid = String(data.current_user_id ?? '').trim();
        setPersonaId(uid || 'demo_user');
      })
      .catch(() => {
        if (!cancelled) setPersonaId('demo_user');
      })
      .finally(() => {
        if (!cancelled) setPersonaResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id]);

  const storageUserKey = session?.user?.id?.trim() || personaId;
  const ready = !authLoading && personaResolved && Boolean(storageUserKey);
  return { storageUserKey: storageUserKey ?? null, ready };
}
