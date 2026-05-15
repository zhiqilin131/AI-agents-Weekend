import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { resilienceLevel, type ResilienceHealth } from '../utils/resilienceUi';

export function useResilienceHealth(intervalMs = 12_000) {
  const [health, setHealth] = useState<ResilienceHealth | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/health/resilience');
      if (!res.ok) throw new Error(res.statusText);
      setHealth((await res.json()) as ResilienceHealth);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) await refresh();
    };
    void run();
    const id = window.setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs, refresh]);

  const level = useMemo(() => resilienceLevel(health, failed), [failed, health]);
  return { health, level, failed, refresh };
}
