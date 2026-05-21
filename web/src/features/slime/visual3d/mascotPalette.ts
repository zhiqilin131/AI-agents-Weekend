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
  sclera: THREE.Vector3;
  iris: THREE.Vector3;
  irisDeep: THREE.Vector3;
  pupil: THREE.Vector3;
  shine: THREE.Vector3;
  /** Subtle theme rim on upper eye catch light */
  rimTint: THREE.Vector3;
};

function animeFaceColors(rimHex: string): MascotFaceColors {
  return {
    mouth: hex('#06060C'),
    sclera: hex('#1A1A22'),
    iris: hex('#0C0C14'),
    irisDeep: hex('#000000'),
    pupil: hex('#000000'),
    shine: hex('#FFFFFF'),
    rimTint: hex(rimHex),
  };
}

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
  /** Shell shader: lerp toward white highlight (lower = richer body color). */
  shellHighlightMix: number;
  shellDarken: number;
};

/** Mochi — saturated blue shell + deeper inner core (not washed-out ice). */
const MOCHI: MascotPalette = {
  body: {
    c0: hex('#9DD4FF'),
    c1: hex('#7BC4FF'),
    c2: hex('#58B0FF'),
    c3: hex('#3D9EFF'),
    c4: hex('#2888F5'),
  },
  inner: {
    base: hex('#4DA8FF'),
    mid: hex('#1A7FE8'),
    deep: hex('#0B63D4'),
    glow: hex('#0854B8'),
  },
  face: animeFaceColors('#6BB8FF'),
  coreColor: '#1A7FE8',
  bodyColor: '#58B0FF',
  highlightColor: '#B8E4FF',
  rimColor: '#3D9EFF',
  jellySoftness: 0.66,
  specularStrength: 1.02,
  shellHighlightMix: 0.06,
  shellDarken: 1,
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
  face: animeFaceColors('#FF9EC8'),
  coreColor: '#FF7AB8',
  bodyColor: '#FFD6EC',
  highlightColor: '#FFF5FA',
  rimColor: '#FFC2E4',
  jellySoftness: 0.74,
  specularStrength: 1.0,
  shellHighlightMix: 0.22,
  shellDarken: 0.94,
};

export function mascotPaletteFor(slimeType: SlimeType): MascotPalette {
  return slimeType === 'wellbeing' ? RIMUMU : MOCHI;
}
