/** Mouth open smoothing — fast attack, softer release between syllables. */
export const MOUTH_OPEN_ATTACK = 0.48;
export const MOUTH_OPEN_RELEASE = 0.24;
export const MOUTH_CLOSED_EPS = 0.04;

export function stepMouthOpenSmooth(current: number, target: number): number {
  const rate = target > current ? MOUTH_OPEN_ATTACK : MOUTH_OPEN_RELEASE;
  return current + (target - current) * rate;
}

export function mouthOpenTarget(
  stateSpeaking: boolean,
  mouthOpen: number,
  surprised: boolean,
): number {
  if (surprised) return Math.min(1, 0.32 + mouthOpen * 0.28);
  if (!stateSpeaking) return 0;
  return Math.min(1, mouthOpen);
}
