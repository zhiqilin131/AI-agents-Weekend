import { describe, expect, it } from 'vitest';
import { slimeBubbleLabel } from './slimeBubbleLabel';

describe('slimeBubbleLabel', () => {
  it('reflects personality in short label', () => {
    expect(slimeBubbleLabel({ name: 'Mochi', personality: 'calm' })).toBe('Mochi shares');
    expect(slimeBubbleLabel({ name: 'Mochi', personality: 'direct' })).toBe('Mochi says');
    expect(slimeBubbleLabel({ name: 'Zoe', personality: 'encouraging' })).toBe('Zoe cheers you on');
    expect(slimeBubbleLabel({ name: 'Ada', personality: 'analytical' })).toBe('Ada notes');
    expect(slimeBubbleLabel({ name: 'Bo', personality: 'playful' })).toBe('Bo chimes in');
    expect(slimeBubbleLabel({ name: 'Sol', personality: 'cautious' })).toBe('Sol flags');
  });
});
