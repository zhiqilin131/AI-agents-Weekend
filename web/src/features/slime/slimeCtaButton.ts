import type { CSSProperties } from 'react';
import type { SlimeThemeColors } from './slimeIdentity';

/** Shared classes for slime-themed primary actions (deeper fill, bright white label, tactile depth). */
export const SLIME_CTA_BTN_CLASS =
  'font-semibold text-white border border-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-[filter,transform,box-shadow] hover:brightness-110 active:translate-y-[2px] active:brightness-95 disabled:opacity-50 disabled:pointer-events-none disabled:translate-y-0';

export function slimeCtaButtonStyle(
  theme: SlimeThemeColors,
  opts?: { muted?: boolean },
): CSSProperties {
  if (opts?.muted) {
    return {
      background: theme.ctaPress,
      boxShadow: `inset 0 2px 5px rgba(0,0,0,0.14), 0 2px 10px ${theme.ctaGlow}`,
      color: '#ffffff',
      textShadow: '0 1px 2px rgba(0,0,0,0.28)',
    };
  }
  return {
    background: `linear-gradient(135deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
    boxShadow: `0 4px 0 ${theme.ctaPress}, 0 10px 22px ${theme.ctaGlow}, inset 0 1px 0 rgba(255,255,255,0.55)`,
    color: '#ffffff',
    textShadow: '0 1px 2px rgba(0,0,0,0.22)',
  };
}
