import { describe, expect, it } from 'vitest';
import { SLIME_IDLE_INTERACT_MS, slimeIdleFidgetIntervalMs } from './slimeIdleBehavior';

describe('slimeIdleBehavior', () => {
  it('uses 10s no-interact threshold', () => {
    expect(SLIME_IDLE_INTERACT_MS).toBe(10_000);
  });

  it('randomizes fidget interval in expected band', () => {
    const samples = Array.from({ length: 20 }, () => slimeIdleFidgetIntervalMs());
    for (const ms of samples) {
      expect(ms).toBeGreaterThanOrEqual(11_000);
      expect(ms).toBeLessThanOrEqual(16_000);
    }
  });
});
