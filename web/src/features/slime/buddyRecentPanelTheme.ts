import type { SlimeThemeColors } from './slimeIdentity';

/** Softer buddy-rail palette — aligned with slime theme but lighter than body chrome. */
export function mochiBuddyRecentPanelTheme(theme: SlimeThemeColors) {
  return {
    border: `${theme.accent}38`,
    surface: '#f6faff',
    highlight: '#edf5ff',
    label: theme.secondary,
    subtitle: '#5c6b82',
    deep: '#4a6fa8',
    shadow: 'rgba(15, 23, 42, 0.05)',
    ctaStyle: {
      background: `linear-gradient(135deg, ${theme.accent}, ${theme.highlight})`,
      borderColor: `${theme.secondary}40`,
      boxShadow: '0 2px 6px rgba(15, 23, 42, 0.06)',
      color: '#ffffff',
    },
    ctaDisabled: {
      border: `1px solid ${theme.accent}30`,
      background: `${theme.highlight}80`,
      color: theme.secondary,
    },
    activeItem: {
      borderColor: `${theme.accent}70`,
      background: `${theme.highlight}b8`,
      boxShadow: 'none',
    },
    idleItem: {
      borderColor: `${theme.border}40`,
      background: 'rgba(255,255,255,0.92)',
    },
  };
}
