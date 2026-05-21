import type { SlimeThemeColors } from './slimeIdentity';
import type { SlimeType } from './slimeIdentity';

/** Low-glare chrome for buddy left rail — minimal colored glow. */
export function buddyCompanionSwitchChrome(
  slimeType: SlimeType,
  theme: SlimeThemeColors,
): { borderColor: string; background: string; boxShadow: string } {
  if (slimeType === 'wellbeing') {
    return {
      borderColor: `${theme.border}55`,
      background: `linear-gradient(180deg, ${theme.surface}ee, rgba(255,255,255,0.94))`,
      boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
    };
  }
  return {
    borderColor: 'rgba(148, 163, 184, 0.28)',
    background: 'linear-gradient(180deg, #fafcff, rgba(255,255,255,0.97))',
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
  };
}
