import { describe, expect, it } from 'vitest';
import { mouthOpenTarget, stepMouthOpenSmooth } from './slimeMouthTalk';

describe('slimeMouthTalk', () => {
  it('closes mouth when not speaking', () => {
    expect(mouthOpenTarget(false, 0.8, false)).toBe(0);
  });

  it('smooths toward open target', () => {
    let v = 0;
    for (let i = 0; i < 8; i += 1) v = stepMouthOpenSmooth(v, 1);
    expect(v).toBeGreaterThan(0.5);
  });
});
