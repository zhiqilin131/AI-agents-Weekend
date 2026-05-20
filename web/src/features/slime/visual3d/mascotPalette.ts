import * as THREE from 'three';
import type { SlimeType } from '../slimeIdentity';

function hex(hex: string): THREE.Vector3 {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Push color away from gray (1 = unchanged). */
export function boostInnerSaturation(v: THREE.Vector3, amount = 1.28): THREE.Vector3 {
  const lum = v.x * 0.299 + v.y * 0.587 + v.z * 0.114;
  const gray = new THREE.Vector3(lum, lum, lum);
  const out = gray.clone().add(v.clone().sub(gray).multiplyScalar(amount));
  return out.clampScalar(0, 1);
}

export function vector3ToHex(v: THREE.Vector3): string {
  const r = Math.round(v.x * 255)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(v.y * 255)
    .toString(16)
    .padStart(2, '0');
  const b = Math.round(v.z * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${b}`;
}

export type MascotBodyGradient = {
  c0: THREE.Vector3;
  c1: THREE.Vector3;
  c2: THREE.Vector3;
  c3: THREE.Vector3;
  c4: THREE.Vector3;
};

/** Saturated inner sphere (73.5% core) — blue for Mochi, pink for Rimumu. */
export type MascotInnerCore = {
  base: THREE.Vector3;
  mid: THREE.Vector3;
  deep: THREE.Vector3;
  glow: THREE.Vector3;
};

export type MascotFaceColors = {
  mouth: THREE.Vector3;
};

export type MascotPalette = {
  /** Light jelly shell (~100% sphere). */
  body: MascotBodyGradient;
  /** Flowing inner core (~73.5% sphere, centered). */
  inner: MascotInnerCore;
  face: MascotFaceColors;
  coreColor: string;
  bodyColor: string;
  highlightColor: string;
  rimColor: string;
  jellySoftness: number;
  specularStrength: number;
};

/** Mochi — vivid sky-blue (low gray), shell + inner core. */
const MOCHI: MascotPalette = {
  body: {
    c0: hex('#FAFEFF'),
    c1: hex('#EFF9FF'),
    c2: hex('#DDF3FF'),
    c3: hex('#C8ECFF'),
    c4: hex('#B2E4FF'),
  },
  inner: {
    base: hex('#C8ECFF'),
    mid: hex('#52B8FF'),
    deep: hex('#2E9EFF'),
    glow: hex('#1A8EF5'),
  },
  face: { mouth: hex('#06060C') },
  coreColor: '#52B8FF',
  bodyColor: '#DDF3FF',
  highlightColor: '#FFFFFF',
  rimColor: '#C8ECFF',
  jellySoftness: 0.72,
  specularStrength: 1.05,
};

/** Rimumu — light pink shell + pink inner core (same structure as Mochi). */
const RIMUMU: MascotPalette = {
  body: {
    c0: hex('#FFF3F9'),
    c1: hex('#FFEAF5'),
    c2: hex('#FFD6EC'),
    c3: hex('#FFC2E4'),
    c4: hex('#FFADD9'),
  },
  inner: {
    base: hex('#FFC8E4'),
    mid: hex('#FF7AB8'),
    deep: hex('#FF4A9E'),
    glow: hex('#F02E88'),
  },
  face: { mouth: hex('#06060C') },
  coreColor: '#FF7AB8',
  bodyColor: '#FFD6EC',
  highlightColor: '#FFF5FA',
  rimColor: '#FFC2E4',
  jellySoftness: 0.74,
  specularStrength: 1.0,
};

export function mascotPaletteFor(slimeType: SlimeType): MascotPalette {
  return slimeType === 'wellbeing' ? RIMUMU : MOCHI;
}
