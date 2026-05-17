import { describe, expect, it } from 'vitest';
import { slimeBubbleLabel } from './slimeBubbleLabel';

describe('slimeBubbleLabel', () => {
  it('uses possessive suggestion label for any personality', () => {
    expect(slimeBubbleLabel({ name: 'Mochi', personality: 'calm' })).toBe("Mochi's suggestion");
    expect(slimeBubbleLabel({ name: 'Zoe', personality: 'encouraging' })).toBe("Zoe's suggestion");
    expect(slimeBubbleLabel({ name: 'Peyton Pritchard', personality: 'direct' })).toBe(
      "Peyton Pritchard's suggestion",
    );
  });
});
