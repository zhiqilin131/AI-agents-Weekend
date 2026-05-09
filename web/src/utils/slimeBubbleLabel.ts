import type { SlimeProfile } from '../app/model';

/** Short attribution line for the recommendation bubble — tone only, no logic impact. */
export function slimeBubbleLabel(
  profile: Pick<SlimeProfile, 'name' | 'personality'> & { persona?: SlimeProfile['persona'] },
): string {
  const name = (profile.name || 'Advisor').trim() || 'Advisor';
  const t = profile.persona?.tone;
  if (t === 'direct' || t === 'concise') return `${name} says`;
  if (t === 'encouraging') return `${name} cheers you on`;
  if (t === 'analytical') return `${name} notes`;
  if (t === 'playful' || t === 'witty') return `${name} chimes in`;
  if (t === 'warm') return `${name} shares`;
  const v = profile.personality;
  switch (v) {
    case 'direct':
      return `${name} says`;
    case 'encouraging':
      return `${name} cheers you on`;
    case 'analytical':
      return `${name} notes`;
    case 'playful':
      return `${name} chimes in`;
    case 'cautious':
      return `${name} flags`;
    case 'calm':
    default:
      return `${name} shares`;
  }
}
