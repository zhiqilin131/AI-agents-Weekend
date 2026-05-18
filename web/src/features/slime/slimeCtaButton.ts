import type { CSSProperties } from 'react';
import type { SlimeThemeColors } from './slimeIdentity';

/** Shared classes for slime-themed primary actions (flat fill, soft shadow). */
export const SLIME_CTA_BTN_CLASS =
  'font-semibold text-white border transition-[filter,background-color,box-shadow] hover:brightness-105 active:brightness-95 disabled:opacity-50 disabled:pointer-events-none';

export function slimeCtaButtonStyle(
  theme: SlimeThemeColors,
  opts?: { muted?: boolean },
): CSSProperties {
  if (opts?.muted) {
    return {
      background: theme.ctaTo,
      borderColor: `${theme.ctaPress}66`,
      boxShadow: `0 2px 8px ${theme.ctaGlow}`,
      color: '#ffffff',
    };
  }
  return {
    background: `linear-gradient(135deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
    borderColor: `${theme.ctaPress}55`,
    boxShadow: `0 4px 14px ${theme.ctaGlow}`,
    color: '#ffffff',
  };
}
