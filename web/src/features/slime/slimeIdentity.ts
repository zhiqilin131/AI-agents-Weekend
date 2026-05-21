/** Fixed Slime identities — theme and copy by type (not user-customizable). */

export type SlimeType = 'generalized' | 'wellbeing';

export type SlimeThemeColors = {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  border: string;
  accent: string;
  /** Lighter rim / highlight */
  highlight: string;
  /** Darker body shadow */
  deep: string;
  /** Ambient glow */
  glow: string;
  /** Readable heading on light panels (not highlight wash) */
  heading: string;
  /** Primary CTA gradient — darker than body for contrast on white UI */
  ctaFrom: string;
  ctaTo: string;
  /** Bottom edge / pressed shadow for tactile buttons */
  ctaPress: string;
  ctaGlow: string;
};

export type SlimeIdentity = {
  id: SlimeType;
  displayName: string;
  shortName: string;
  tagline: string;
  /** Origin story — shown in About and used in prompts. */
  personaBackstory: string;
  personaSelfIntro: string;
  personaTraits: string[];
  theme: SlimeThemeColors;
};

/** Layered Mochi — deeper, obvious blue (2D + UI chrome) */
const MOCHI_THEME: SlimeThemeColors = {
  deep: '#0F2D6E',
  primary: '#1D5FD4',
  secondary: '#2B7CE8',
  accent: '#3B94F0',
  highlight: '#5CAFFF',
  glow: '#7EC0FA',
  background: '#B8DCFF',
  surface: '#9CC8F5',
  border: '#3B94F0',
  heading: '#0F2D6E',
  ctaFrom: '#1A4FB8',
  ctaTo: '#1D5FD4',
  ctaPress: '#0F2D6E',
  ctaGlow: 'rgba(29, 95, 212, 0.42)',
};

/** Layered Rimumu — soft rose / blush (calm, light, comforting — no dark tones) */
const RIMUMU_THEME: SlimeThemeColors = {
  deep: '#E8B4BC',
  primary: '#E8A0B0',
  secondary: '#F5D0D8',
  accent: '#F0B8C4',
  highlight: '#FFF5F7',
  glow: 'rgba(240, 184, 196, 0.45)',
  background: '#FFF8F6',
  surface: '#FCEFEA',
  border: '#F0D4DA',
  heading: '#9E4A5A',
  ctaFrom: '#B53652',
  ctaTo: '#D4516B',
  ctaPress: '#8E2A40',
  ctaGlow: 'rgba(181, 54, 82, 0.42)',
};

export const SLIME_IDENTITIES: Record<SlimeType, SlimeIdentity> = {
  generalized: {
    id: 'generalized',
    displayName: 'Mochi',
    shortName: 'Mochi',
    tagline:
      'Your everyday decision companion for thoughts, plans, reports, and next steps.',
    personaBackstory:
      'Mochi is a small blue slime who woke on a planning notebook — a dew-bead that learned to bounce.',
    personaSelfIntro:
      "I'm Mochi — a small blue slime and your everyday decision buddy. I help you think through plans, choices, and next steps.",
    personaTraits: ['curious', 'practical', 'warm', 'gently humorous', 'decisive with honest caveats'],
    theme: MOCHI_THEME,
  },
  wellbeing: {
    id: 'wellbeing',
    displayName: 'Rimumu',
    shortName: 'Rimumu',
    tagline:
      'A gentle doctor-coded emotional support companion for stress, overwhelm, reflection, and small next steps. Not a replacement for professional care.',
    personaBackstory:
      'Rimumu is a soft rose-hued wellbeing slime with gentle doctor-like calm — a warm listener for stress and overwhelm, not a clinician.',
    personaSelfIntro:
      "I'm Rimumu — your gentle wellbeing doctor-slime. I'm here for stress, overwhelm, reflection, and small next steps, while not replacing professional care.",
    personaTraits: ['warm', 'gently enthusiastic', 'validating', 'patient', 'structured', 'autonomy-first'],
    theme: RIMUMU_THEME,
  },
};

export const SLIME_TYPE_ORDER: SlimeType[] = ['generalized', 'wellbeing'];

/** OpenAI TTS voice — fixed per Slime (not user-customizable). */
export const SLIME_TTS_VOICES: Record<SlimeType, string> = {
  generalized: 'onyx',
  wellbeing: 'shimmer',
};

export function ttsVoiceForSlimeType(slimeType: SlimeType): string {
  return SLIME_TTS_VOICES[slimeType];
}

export function nextSlimeType(current: SlimeType): SlimeType {
  const i = SLIME_TYPE_ORDER.indexOf(current);
  return SLIME_TYPE_ORDER[(i + 1) % SLIME_TYPE_ORDER.length]!;
}

export function prevSlimeType(current: SlimeType): SlimeType {
  const i = SLIME_TYPE_ORDER.indexOf(current);
  return SLIME_TYPE_ORDER[(i - 1 + SLIME_TYPE_ORDER.length) % SLIME_TYPE_ORDER.length]!;
}

export function normalizeSlimeType(raw: string | null | undefined): SlimeType | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'generalized' || v === 'general' || v === 'default' || v === 'mochi' || v === 'slime') {
    return 'generalized';
  }
  if (v === 'wellbeing' || v === 'well-being' || v === 'care' || v === 'rimumu' || v === 'doctor') {
    return 'wellbeing';
  }
  return null;
}

export function getSlimeIdentity(slimeType: SlimeType): SlimeIdentity {
  return SLIME_IDENTITIES[slimeType];
}

/** Foresight Decision Mode is Mochi-only; Rimumu uses wellbeing conversation flow. */
export function slimeSupportsDecisionMode(slimeType: SlimeType | string | null | undefined): boolean {
  return normalizeSlimeType(slimeType ?? null) !== 'wellbeing';
}

/** Body / rim / highlight for SlimeAdvisor & 3D studio */
export function slimeThemePaletteForType(slimeType: SlimeType): {
  a: string;
  b: string;
  c: string;
  ring: string;
  deep: string;
  glow: string;
} {
  const t = getSlimeIdentity(slimeType).theme;
  return {
    a: t.primary,
    b: t.secondary,
    c: t.highlight,
    ring: `${t.glow}`,
    deep: t.deep,
    glow: t.glow,
  };
}

export function studioBackgroundStyle(slimeType: SlimeType): string {
  const t = getSlimeIdentity(slimeType).theme;
  if (slimeType === 'wellbeing') {
    return (
      `radial-gradient(ellipse 90% 80% at 50% 28%, ${t.highlight} 0%, transparent 55%), ` +
      `radial-gradient(ellipse 70% 50% at 80% 20%, ${t.secondary}66 0%, transparent 45%), ` +
      `linear-gradient(165deg, ${t.background} 0%, ${t.surface} 42%, #fff5f7 78%, #fce8ee 100%)`
    );
  }
  return (
    `radial-gradient(ellipse 85% 75% at 50% 32%, ${t.highlight}cc 0%, transparent 52%), ` +
    `linear-gradient(155deg, ${t.background} 0%, ${t.surface} 48%, ${t.glow}55 100%)`
  );
}

/** Slime Buddy stage canvas — near-white with a whisper of slime theme. */
export function buddyPageCanvasBackground(slimeType: SlimeType): { base: string; overlay: string } {
  const t = getSlimeIdentity(slimeType).theme;
  const whisper = (color: string, pct: number) =>
    `color-mix(in srgb, white ${100 - pct}%, ${color} ${pct}%)`;
  const tintPct = slimeType === 'wellbeing' ? 3.5 : 3;
  const edgePct = 4.5;
  const accent = whisper(t.highlight, tintPct);
  const edge = whisper(t.surface, edgePct);

  return {
    base: `linear-gradient(165deg, #ffffff 0%, ${accent} 52%, ${edge} 100%)`,
    overlay:
      `radial-gradient(ellipse 78% 58% at 50% 30%, color-mix(in srgb, ${t.glow} 4%, transparent), transparent 74%), ` +
      `radial-gradient(circle at 22% 78%, color-mix(in srgb, ${t.secondary} 2.5%, transparent), transparent 44%), ` +
      `radial-gradient(circle at 78% 76%, color-mix(in srgb, ${t.accent} 2%, transparent), transparent 42%)`,
  };
}

/** Full-page chat shell background — always light and soft */
export function chatPageBackgroundStyle(slimeType: SlimeType): string {
  const t = getSlimeIdentity(slimeType).theme;
  if (slimeType === 'wellbeing') {
    return `linear-gradient(135deg, ${t.background} 0%, #fff5f7 45%, #fdf8ff 100%)`;
  }
  return `linear-gradient(135deg, ${t.background} 0%, #d4e8ff 40%, #b8dcff 100%)`;
}
