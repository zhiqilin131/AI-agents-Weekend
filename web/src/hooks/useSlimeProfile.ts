import { useCallback, useEffect, useState } from 'react';
import type { SlimePersona, SlimeProfile, SlimeSelfModelView } from '../app/model';
import { DEFAULT_SLIME_PERSONA } from '../features/slime/slimePersonaPresets';
import { apiUrl } from '../utils/apiOrigin';

/** PATCH body: use `null` to clear optional fields on the server. */
export type SlimeProfileApiPatch = Partial<Omit<SlimeProfile, 'customColors' | 'voice' | 'persona'>> & {
  customColors?: SlimeProfile['customColors'] | null;
  voice?: SlimeProfile['voice'] | null;
  persona?: SlimeProfile['persona'] | null;
};

export const DEFAULT_SLIME_PROFILE: SlimeProfile = {
  name: 'Mochi',
  colorTheme: 'violet',
  personality: 'calm',
  shape: 'classic',
  accessory: 'none',
  motion: 'normal',
  persona: { ...DEFAULT_SLIME_PERSONA },
  updated_at: '',
  slimeSelfModel: null,
};

function clamp0to3(n: unknown, fallback: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  const x = Number(n);
  if (Number.isNaN(x)) return fallback;
  const r = Math.max(0, Math.min(3, Math.round(x)));
  return r as 0 | 1 | 2 | 3;
}

function toCamelPersona(raw: unknown): SlimePersona {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SLIME_PERSONA };
  const r = raw as Record<string, unknown>;
  const catchRaw = r.catchphrases;
  const phrases = Array.isArray(catchRaw)
    ? catchRaw.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 3)
    : [];
  const dontRaw = r.donts;
  const donts = Array.isArray(dontRaw)
    ? dontRaw.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 5)
    : typeof dontRaw === 'string'
      ? dontRaw
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];
  const nick = r.userNickname ?? r.user_nickname;
  const relRaw = r.companionRelationship ?? r.companion_relationship;
  const rel =
    relRaw === null || relRaw === undefined
      ? DEFAULT_SLIME_PERSONA.companionRelationship
      : (String(relRaw).trim() as SlimePersona['companionRelationship']);
  return {
    userNickname: nick === null || nick === undefined ? null : String(nick).trim().slice(0, 24) || null,
    companionRelationship: rel ?? DEFAULT_SLIME_PERSONA.companionRelationship,
    roleIdentity: String(r.roleIdentity ?? r.role_identity ?? DEFAULT_SLIME_PERSONA.roleIdentity).slice(0, 500),
    personalityPreset: (r.personalityPreset ??
      r.personality_preset ??
      DEFAULT_SLIME_PERSONA.personalityPreset) as SlimePersona['personalityPreset'],
    tone: (r.tone ?? DEFAULT_SLIME_PERSONA.tone) as SlimePersona['tone'],
    warmth: clamp0to3(r.warmth, DEFAULT_SLIME_PERSONA.warmth),
    humor: clamp0to3(r.humor, DEFAULT_SLIME_PERSONA.humor),
    directness: clamp0to3(r.directness, DEFAULT_SLIME_PERSONA.directness),
    replyLength: (r.replyLength ?? r.reply_length ?? DEFAULT_SLIME_PERSONA.replyLength) as SlimePersona['replyLength'],
    catchphrases: phrases.map((p) => p.slice(0, 40)),
    donts: donts.map((d) => d.slice(0, 200)),
    updated_at: String(r.updated_at ?? r.updatedAt ?? ''),
  };
}

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

/** Normalize GET /api/profile/slime ``slime_self_model`` for UI. */
export function normalizeSlimeSelfModel(raw: unknown): SlimeSelfModelView | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const abilities = Array.isArray(o.abilities) ? o.abilities.map((x) => String(x)).filter(Boolean) : [];
  const limitations = Array.isArray(o.limitations) ? o.limitations.map((x) => String(x)).filter(Boolean) : [];
  const boundaries = Array.isArray(o.boundaries) ? o.boundaries.map((x) => String(x)).filter(Boolean) : [];
  return {
    name: String(o.name ?? ''),
    nameSafeForUi: Boolean(o.name_safe_for_ui ?? o.nameSafeForUi),
    spokenName: String(o.spoken_name ?? o.spokenName ?? o.name ?? ''),
    relationshipToUser: String(o.relationship_to_user ?? o.relationshipToUser ?? 'helper_pet_companion'),
    abilities,
    limitations,
    boundaries,
  };
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
    persona: toCamelPersona(raw.persona),
    updated_at: String(raw.updated_at ?? raw.updatedAt ?? ''),
    slimeSelfModel: normalizeSlimeSelfModel(raw.slime_self_model ?? raw.slimeSelfModel),
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
        persona: null,
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
