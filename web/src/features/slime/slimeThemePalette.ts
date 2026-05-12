import type { SlimeProfile } from '../../app/model';

/** Body / rim / highlight hexes — same mapping as ``SlimeAdvisor`` (2D + 3D slime). */
export function slimeThemePalette(p: SlimeProfile): {
  a: string;
  b: string;
  c: string;
  ring: string;
} {
  if (p.colorTheme === 'custom' && p.customColors) {
    return {
      a: p.customColors.primary,
      b: p.customColors.secondary,
      c: p.customColors.glow,
      ring: `${p.customColors.glow}66`,
    };
  }
  switch (p.colorTheme) {
    case 'aurora':
      return { a: '#60a5fa', b: '#22d3ee', c: '#a78bfa', ring: 'rgba(34,211,238,0.32)' };
    case 'mint':
      return { a: '#34d399', b: '#2dd4bf', c: '#67e8f9', ring: 'rgba(45,212,191,0.35)' };
    case 'sunset':
      return { a: '#fb7185', b: '#fb923c', c: '#facc15', ring: 'rgba(251,146,60,0.34)' };
    case 'lime':
      return { a: '#84cc16', b: '#bef264', c: '#22d3ee', ring: 'rgba(163,230,53,0.3)' };
    case 'silver':
      return { a: '#e5e7eb', b: '#cbd5e1', c: '#94a3b8', ring: 'rgba(148,163,184,0.32)' };
    default:
      return { a: '#a78bfa', b: '#818cf8', c: '#38bdf8', ring: 'rgba(129,140,248,0.32)' };
  }
}
