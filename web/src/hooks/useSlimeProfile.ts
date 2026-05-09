import { useCallback, useEffect, useState } from 'react';
import type { SlimeProfile } from '../app/model';
import { apiUrl } from '../utils/apiOrigin';

/** PATCH body: use `null` to clear optional fields on the server. */
export type SlimeProfileApiPatch = Partial<Omit<SlimeProfile, 'customColors' | 'voice'>> & {
  customColors?: SlimeProfile['customColors'] | null;
  voice?: SlimeProfile['voice'] | null;
};

export const DEFAULT_SLIME_PROFILE: SlimeProfile = {
  name: 'Mochi',
  colorTheme: 'violet',
  personality: 'calm',
  shape: 'classic',
  accessory: 'none',
  motion: 'normal',
  updated_at: '',
};

let cached: SlimeProfile | null = null;
let inflight: Promise<SlimeProfile> | null = null;
const listeners = new Set<(profile: SlimeProfile) => void>();

function normalizeCustomColors(raw: unknown): SlimeProfile['customColors'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, string>;
  const primary = String(o.primary ?? '').trim();
  const secondary = String(o.secondary ?? '').trim();
  const glow = String(o.glow ?? '').trim();
  if (!primary || !secondary || !glow) return undefined;
  return { primary, secondary, glow };
}

function toCamelProfile(raw: any): SlimeProfile {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SLIME_PROFILE };
  const ccRaw = raw.customColors ?? raw.custom_colors;
  const customColors = ccRaw === null || ccRaw === undefined ? undefined : normalizeCustomColors(ccRaw);
  const voiceRaw = raw.voice;
  const voice =
    voiceRaw && typeof voiceRaw === 'object'
      ? {
          // Default on when the key is missing (backend used to default enabled to false).
          enabled: voiceRaw.enabled !== false && voiceRaw.enabled !== null,
          rate: Number(voiceRaw.rate ?? 1),
          pitch: Number(voiceRaw.pitch ?? 1),
          preferredVoiceName: voiceRaw.preferredVoiceName ?? voiceRaw.preferred_voice_name ?? undefined,
        }
      : undefined;
  return {
    name: String(raw.name ?? DEFAULT_SLIME_PROFILE.name),
    colorTheme: (raw.colorTheme ?? raw.color_theme ?? DEFAULT_SLIME_PROFILE.colorTheme) as SlimeProfile['colorTheme'],
    customColors,
    personality: (raw.personality ?? DEFAULT_SLIME_PROFILE.personality) as SlimeProfile['personality'],
    shape: (raw.shape ?? DEFAULT_SLIME_PROFILE.shape) as SlimeProfile['shape'],
    accessory: (raw.accessory ?? DEFAULT_SLIME_PROFILE.accessory) as SlimeProfile['accessory'],
    motion: (raw.motion ?? DEFAULT_SLIME_PROFILE.motion) as SlimeProfile['motion'],
    voice,
    updated_at: String(raw.updated_at ?? raw.updatedAt ?? ''),
  };
}

function notify(profile: SlimeProfile) {
  listeners.forEach((fn) => fn(profile));
}

async function fetchSlimeProfile(): Promise<SlimeProfile> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch(apiUrl('/api/profile/slime'), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load slime profile'))))
    .then((data) => {
      cached = toCamelProfile(data);
      notify(cached);
      return cached;
    })
    .catch(() => {
      const fallback = cached ?? { ...DEFAULT_SLIME_PROFILE };
      return fallback;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** After persona create/delete (no full reload): drop cache and refetch for all listeners. */
export async function refetchSlimeProfileGlobal(): Promise<SlimeProfile> {
  cached = null;
  inflight = null;
  try {
    const r = await fetch(apiUrl('/api/profile/slime'), { cache: 'no-store' });
    if (!r.ok) throw new Error('Failed to load slime profile');
    const p = toCamelProfile(await r.json());
    cached = p;
    notify(p);
    return p;
  } catch {
    const fb = { ...DEFAULT_SLIME_PROFILE };
    notify(fb);
    return fb;
  }
}

export function useSlimeProfile() {
  const [slimeProfile, setSlimeProfile] = useState<SlimeProfile>(cached ?? DEFAULT_SLIME_PROFILE);
  const [isLoading, setIsLoading] = useState<boolean>(cached == null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listeners.add(setSlimeProfile);
    return () => {
      listeners.delete(setSlimeProfile);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(cached == null);
    void fetchSlimeProfile()
      .then((p) => {
        if (cancelled) return;
        setSlimeProfile(p);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load slime profile');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSlimeProfile = useCallback(async (patch: SlimeProfileApiPatch): Promise<SlimeProfile> => {
    setError(null);
    const res = await fetch(apiUrl('/api/profile/slime'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || 'Failed to update slime profile');
    }
    const next = toCamelProfile(await res.json());
    cached = next;
    notify(next);
    return next;
  }, []);

  const resetSlimeProfile = useCallback(
    () =>
      updateSlimeProfile({
        name: DEFAULT_SLIME_PROFILE.name,
        colorTheme: DEFAULT_SLIME_PROFILE.colorTheme,
        personality: DEFAULT_SLIME_PROFILE.personality,
        shape: DEFAULT_SLIME_PROFILE.shape,
        accessory: DEFAULT_SLIME_PROFILE.accessory,
        motion: DEFAULT_SLIME_PROFILE.motion,
        customColors: null,
        voice: { enabled: false, rate: 1, pitch: 1 },
      }),
    [updateSlimeProfile],
  );

  const refreshSlimeProfile = useCallback(async () => {
    const prev = cached;
    cached = null;
    inflight = null;
    try {
      const r = await fetch(apiUrl('/api/profile/slime'), { cache: 'no-store' });
      if (!r.ok) throw new Error('Failed to load slime profile');
      const p = toCamelProfile(await r.json());
      cached = p;
      notify(p);
      return p;
    } catch {
      cached = prev;
      if (prev) {
        notify(prev);
        return prev;
      }
      const fb = { ...DEFAULT_SLIME_PROFILE };
      notify(fb);
      return fb;
    }
  }, []);

  return { slimeProfile, isLoading, error, updateSlimeProfile, resetSlimeProfile, refreshSlimeProfile };
}
