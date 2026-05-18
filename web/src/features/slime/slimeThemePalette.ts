import type { SlimeProfile } from '../../app/model';
import { normalizeSlimeType, slimeThemePaletteForType, type SlimeType } from './slimeIdentity';

/** Body / rim / highlight hexes — fixed by Slime type (ignores legacy profile color_theme). */
export function slimeThemePalette(
  p: SlimeProfile,
  slimeType?: SlimeType | string | null,
): {
  a: string;
  b: string;
  c: string;
  ring: string;
  deep: string;
  glow: string;
} {
  const st = normalizeSlimeType(slimeType ?? null) ?? 'generalized';
  return slimeThemePaletteForType(st);
}
