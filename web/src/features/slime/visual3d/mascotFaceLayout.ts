import { SLIME_BLOB_RADIUS, SLIME_BLOB_SCALE } from './mascotGeometry';

export type MascotFaceLayout = {
  eyeSpacing: number;
  eyeY: number;
  eyeZ: number;
  eyeWidth: number;
  eyeHeight: number;
  mouthY: number;
  /** Horizontal face span for mouth sizing. */
  faceWidth: number;
};

/** Shared face layout — only palette differs between Mochi / Rimumu. */
export function mascotFaceLayout(): MascotFaceLayout {
  const R = SLIME_BLOB_RADIUS * SLIME_BLOB_SCALE[0];
  const eyeSpacing = 0.1;
  const eyeY = 0.05;
  const surfaceZ = Math.sqrt(Math.max(R * R - eyeSpacing * eyeSpacing - eyeY * eyeY, 0.01));

  const eyeWidth = 0.013;
  const faceWidth = (eyeSpacing + eyeWidth) * 2;

  return {
    eyeSpacing,
    eyeY,
    eyeZ: surfaceZ + 0.032,
    eyeWidth,
    eyeHeight: 0.024,
    mouthY: -0.072,
    faceWidth,
  };
}
