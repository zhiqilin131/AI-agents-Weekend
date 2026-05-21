import { describe, expect, it } from 'vitest';
import { slimeModelDockAbbrev } from './slimeModelDockAbbrev';

describe('slimeModelDockAbbrev', () => {
  it('maps known slime tiers to three-letter badges', () => {
    expect(slimeModelDockAbbrev('little', 'Little Slime')).toBe('LIT');
    expect(slimeModelDockAbbrev('swift', 'Swift Slime')).toBe('SWF');
    expect(slimeModelDockAbbrev('balanced', 'Balanced Slime')).toBe('BAL');
    expect(slimeModelDockAbbrev('deep', 'Deep Slime')).toBe('DEE');
    expect(slimeModelDockAbbrev('slime_55', '5.5')).toBe('5.5');
    expect(slimeModelDockAbbrev('research', 'Research Slime')).toBe('RES');
  });

  it('falls back to first word letters for unknown ids', () => {
    expect(slimeModelDockAbbrev('custom_tier', 'Turbo Slime')).toBe('TUR');
  });
});
