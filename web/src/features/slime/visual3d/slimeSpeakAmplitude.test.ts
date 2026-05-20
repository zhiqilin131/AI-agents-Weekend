import { describe, expect, it } from 'vitest';
import {
  getSlimeSpeakAmplitude,
  resetSlimeSpeakAmplitude,
  setSlimeSpeakAmplitude,
} from './slimeSpeakAmplitude';

describe('slimeSpeakAmplitude', () => {
  it('follows envelope and clamps', () => {
    resetSlimeSpeakAmplitude();
    for (let i = 0; i < 6; i += 1) setSlimeSpeakAmplitude(1);
    expect(getSlimeSpeakAmplitude()).toBeGreaterThan(0.2);
    expect(getSlimeSpeakAmplitude()).toBeLessThanOrEqual(0.92);
    resetSlimeSpeakAmplitude();
    expect(getSlimeSpeakAmplitude()).toBe(0);
  });
});
