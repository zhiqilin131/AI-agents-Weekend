import type { SlimeProfile } from '../app/model';

/** Attribution line for the merged recommendation + read-aloud bubble. */
export function slimeBubbleLabel(
  profile: Pick<SlimeProfile, 'name' | 'personality'> & { persona?: SlimeProfile['persona'] },
): string {
  const name = (profile.name || 'Advisor').trim() || 'Advisor';
  return `${name}'s suggestion`;
}
