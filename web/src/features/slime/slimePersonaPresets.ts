import type { SlimePersona, SlimePersonalityPreset } from '../../app/model';

export const DEFAULT_SLIME_PERSONA: SlimePersona = {
  userNickname: null,
  companionRelationship: 'helper_pet_companion',
  roleIdentity:
    'A personal decision companion that helps the user think clearly, remember context, and turn decisions into action.',
  personalityPreset: 'calm_advisor',
  tone: 'warm',
  warmth: 2,
  humor: 1,
  directness: 1,
  replyLength: 'balanced',
  catchphrases: [],
  donts: [],
  updated_at: '',
};

const PRESET_PATCH: Record<
  SlimePersonalityPreset,
  Pick<SlimePersona, 'tone' | 'warmth' | 'humor' | 'directness' | 'replyLength'>
> = {
  calm_advisor: { tone: 'calm', warmth: 1, humor: 0, directness: 1, replyLength: 'balanced' },
  direct_strategist: { tone: 'direct', warmth: 0, humor: 0, directness: 3, replyLength: 'short' },
  warm_friend: { tone: 'warm', warmth: 3, humor: 1, directness: 1, replyLength: 'balanced' },
  playful_pet: { tone: 'playful', warmth: 3, humor: 2, directness: 1, replyLength: 'short' },
  analytical_coach: { tone: 'analytical', warmth: 1, humor: 0, directness: 2, replyLength: 'detailed' },
  hype_buddy: { tone: 'encouraging', warmth: 2, humor: 2, directness: 2, replyLength: 'short' },
  gentle_companion: { tone: 'warm', warmth: 3, humor: 0, directness: 0, replyLength: 'balanced' },
  minimalist_assistant: { tone: 'concise', warmth: 0, humor: 0, directness: 2, replyLength: 'short' },
};

export const SLIME_PERSONA_PRESET_OPTIONS: Array<{ id: SlimePersonalityPreset; label: string }> = [
  { id: 'calm_advisor', label: 'Calm Advisor' },
  { id: 'direct_strategist', label: 'Direct Strategist' },
  { id: 'warm_friend', label: 'Warm Friend' },
  { id: 'playful_pet', label: 'Playful Pet' },
  { id: 'analytical_coach', label: 'Analytical Coach' },
  { id: 'hype_buddy', label: 'Hype Buddy' },
  { id: 'gentle_companion', label: 'Gentle Therapist-like Companion' },
  { id: 'minimalist_assistant', label: 'Minimalist Assistant' },
];

export const SLIME_TONE_OPTIONS: Array<{ id: SlimePersona['tone']; label: string }> = [
  { id: 'calm', label: 'Calm' },
  { id: 'warm', label: 'Warm' },
  { id: 'direct', label: 'Direct' },
  { id: 'playful', label: 'Playful' },
  { id: 'analytical', label: 'Analytical' },
  { id: 'encouraging', label: 'Encouraging' },
  { id: 'witty', label: 'Witty' },
  { id: 'concise', label: 'Concise' },
];

export function patchForPersonalityPreset(
  preset: SlimePersonalityPreset,
): Pick<SlimePersona, 'personalityPreset' | 'tone' | 'warmth' | 'humor' | 'directness' | 'replyLength'> {
  return { personalityPreset: preset, ...PRESET_PATCH[preset] };
}
