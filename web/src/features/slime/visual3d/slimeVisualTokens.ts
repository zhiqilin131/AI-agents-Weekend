import * as THREE from 'three';
import type { SlimeType } from '../slimeIdentity';
import type { SlimeProfile } from '../../../app/model';
import { SLIME_BLOB_SCALE } from './mascotGeometry';
import { mascotPaletteFor } from './mascotPalette';

/** @deprecated Use mascot palette in 3D; kept for exports. */
export type SlimeShaderColors = {
  primary: THREE.Vector3;
  secondary: THREE.Vector3;
  highlight: THREE.Vector3;
  deep: THREE.Vector3;
  glow: THREE.Vector3;
};

export function slimeShaderColors(slimeType: SlimeType): SlimeShaderColors {
  const p = mascotPaletteFor(slimeType);
  return {
    primary: p.inner.mid.clone(),
    secondary: p.inner.base.clone(),
    highlight: p.body.c0.clone(),
    deep: p.inner.deep.clone(),
    glow: p.inner.glow.clone(),
  };
}

export const SLIME_BODY_RADIUS = 0.42;

export function slimeBodyScale(_slimeType: SlimeType, _profile: SlimeProfile): [number, number, number] {
  return SLIME_BLOB_SCALE;
}

export function slimeShaderColorsForType(slimeType: SlimeType): SlimeShaderColors {
  return slimeShaderColors(slimeType);
}

export function slimeBreathPeriod(slimeType: SlimeType, profile: SlimeProfile): number {
  const base = slimeType === 'wellbeing' ? 3.8 * 1.35 : 2.6;
  const motion = profile.motion === 'subtle' ? 1.2 : profile.motion === 'expressive' ? 0.82 : 1;
  const personality =
    profile.personality === 'calm' ? 1.15 : profile.personality === 'playful' ? 0.9 : 1;
  return base * motion * personality;
}
