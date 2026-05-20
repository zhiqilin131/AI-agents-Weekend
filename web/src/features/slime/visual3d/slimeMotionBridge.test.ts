import { describe, expect, it } from 'vitest';
import { slimeMotionUniforms } from './slimeMotionBridge';
import { DEFAULT_SLIME_PROFILE } from '../../../hooks/useSlimeProfile';

describe('slimeMotionBridge', () => {
  it('maps each advisor state to a stable index', () => {
    const idle = slimeMotionUniforms('idle', 'generalized', DEFAULT_SLIME_PROFILE, 0);
    const speaking = slimeMotionUniforms('speaking', 'generalized', DEFAULT_SLIME_PROFILE, 1.2, 0.6);
    expect(idle.stateIndex).toBe(0);
    expect(speaking.stateIndex).toBe(5);
  });

  it('increases mouth open while speaking with amplitude', () => {
    const idle = slimeMotionUniforms('idle', 'generalized', DEFAULT_SLIME_PROFILE, 0);
    const silent = slimeMotionUniforms('speaking', 'generalized', DEFAULT_SLIME_PROFILE, 1.2, 0);
    const speaking = slimeMotionUniforms('speaking', 'generalized', DEFAULT_SLIME_PROFILE, 1.2, 0.6);
    expect(speaking.mouthOpen).toBeGreaterThan(idle.mouthOpen);
    expect(speaking.mouthOpen).toBeGreaterThan(silent.mouthOpen);
    expect(speaking.speak).toBeGreaterThan(0);
  });

  it('keeps speaking wobble minimal', () => {
    const mochi = slimeMotionUniforms('speaking', 'generalized', DEFAULT_SLIME_PROFILE, 2, 0.5);
    const rimumu = slimeMotionUniforms('speaking', 'wellbeing', DEFAULT_SLIME_PROFILE, 2, 0.5);
    expect(mochi.wobble).toBeLessThanOrEqual(0.03);
    expect(rimumu.wobble).toBeLessThanOrEqual(0.03);
    expect(mochi.vertexWobble).toBe(0);
    expect(rimumu.vertexWobble).toBe(0);
  });

  it('inner core breath is decoupled from outer shell', () => {
    const samples = [0, 0.8, 1.6, 2.4, 3.2].map((t) =>
      slimeMotionUniforms('idle', 'generalized', DEFAULT_SLIME_PROFILE, t),
    );
    expect(samples.some((u) => Math.abs(u.innerSquashY - u.squashY) > 0.01)).toBe(true);
    expect(samples.some((u) => u.innerPulse > u.pulse)).toBe(true);
  });

  it('wellbeing speaking is gentler on body squash', () => {
    const mochi = slimeMotionUniforms('speaking', 'generalized', DEFAULT_SLIME_PROFILE, 2, 0.5);
    const rimumu = slimeMotionUniforms('speaking', 'wellbeing', DEFAULT_SLIME_PROFILE, 2, 0.5);
    expect(Math.abs(mochi.squashY - 1)).toBeLessThan(0.04);
    expect(Math.abs(rimumu.squashY - 1)).toBeLessThan(0.04);
  });
});
