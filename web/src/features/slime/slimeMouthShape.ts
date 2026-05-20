import * as THREE from 'three';

/** Mouth span as fraction of face width (spec: 12–18%). */
export const SLIME_CAT_MOUTH_FACE_FRAC = 0.15;

export type CompactCatMouth = {
  halfW: number;
  cornerLift: number;
  centerDrop: number;
  outward: number;
  cheekY: number;
};

/** Compact ω / :3 — two short arcs, slight center dip, not a wide U smile. */
export function compactCatMouth(faceWidth: number): CompactCatMouth {
  const halfW = (faceWidth * SLIME_CAT_MOUTH_FACE_FRAC) / 2;
  const cornerLift = halfW * 0.38;
  const centerDrop = halfW * 0.5;
  return {
    halfW,
    cornerLift,
    centerDrop,
    outward: halfW * 0.14,
    cheekY: centerDrop * 0.62,
  };
}

/** 2D SVG path — two quadratic strokes meeting at center dip. */
export function slimeCatMouthPathD(cx: number, cy: number, faceWidth: number): string {
  const m = compactCatMouth(faceWidth);
  const top = cy - m.cornerLift;
  const bottom = cy + m.centerDrop;
  const lx = cx - m.halfW;
  const rx = cx + m.halfW;
  const lcx = lx - m.outward;
  const rcx = rx + m.outward;
  const cheek = cy + m.cheekY;
  return `M${lx} ${top} Q${lcx} ${cheek} ${cx} ${bottom} M${cx} ${bottom} Q${rcx} ${cheek} ${rx} ${top}`;
}

/** 3D (Y up): corner lift +, center dip −. */
export function catMouthBezierCurves3(faceWidth: number): {
  left: THREE.QuadraticBezierCurve3;
  right: THREE.QuadraticBezierCurve3;
} {
  const m = compactCatMouth(faceWidth);
  const z = 0;
  const centerY = -m.centerDrop;
  const cheekY = -m.cheekY;
  return {
    left: new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-m.halfW, m.cornerLift, z),
      new THREE.Vector3(-m.halfW - m.outward, cheekY, z),
      new THREE.Vector3(0, centerY, z),
    ),
    right: new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, centerY, z),
      new THREE.Vector3(m.halfW + m.outward, cheekY, z),
      new THREE.Vector3(m.halfW, m.cornerLift, z),
    ),
  };
}

/** Face width in 3D layout units (between outer eye edges). */
export function mascotFaceWidth3d(eyeSpacing: number, eyeWidth: number): number {
  return (eyeSpacing + eyeWidth) * 2;
}
