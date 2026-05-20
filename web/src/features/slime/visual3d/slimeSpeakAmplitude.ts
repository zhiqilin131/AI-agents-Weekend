import { useEffect, useState } from 'react';

/** Fast attack / softer release — syllable-shaped envelope for lip sync. */
const ATTACK = 0.52;
const RELEASE = 0.22;
const MAX_AMP = 0.92;
const PUBLISH_EPS = 0.012;

let envelope = 0;
let published = 0;
const listeners = new Set<(v: number) => void>();

/** Push raw 0–1 sample; publishes envelope follower for mouth/body. */
export function setSlimeSpeakAmplitude(raw: number): void {
  const target = Math.max(0, Math.min(1, raw));
  const coeff = target > envelope ? ATTACK : RELEASE;
  envelope += (target - envelope) * coeff;
  const clamped = Math.min(MAX_AMP, envelope);
  if (Math.abs(clamped - published) < PUBLISH_EPS) return;
  published = clamped;
  listeners.forEach((fn) => fn(clamped));
}

export function resetSlimeSpeakAmplitude(): void {
  envelope = 0;
  published = 0;
  listeners.forEach((fn) => fn(0));
}

export function getSlimeSpeakAmplitude(): number {
  return published;
}

export function useSlimeSpeakAmplitude(): number {
  const [v, setV] = useState(published);
  useEffect(() => {
    const fn = (next: number) => setV(next);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return v;
}
