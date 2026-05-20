import { describe, expect, it } from 'vitest';
import { eyeExpressionFromState, eyeParamsForExpression } from './slimeEyeExpression';

describe('slimeEyeExpression', () => {
  it('maps listening to curious', () => {
    expect(eyeExpressionFromState('listening')).toBe('curious');
  });

  it('maps speaking to happy (no wide eyes)', () => {
    expect(eyeExpressionFromState('speaking')).toBe('happy');
  });

  it('celebrating uses surprised', () => {
    expect(eyeExpressionFromState('celebrating')).toBe('surprised');
  });

  it('curious params enlarge eyes slightly when listening', () => {
    const calm = eyeParamsForExpression('curious', 0);
    const loud = eyeParamsForExpression('curious', 1);
    expect(loud.eyeScale).toBeGreaterThan(calm.eyeScale);
  });

  it('surprised opens eyes via eyeOpen', () => {
    const p = eyeParamsForExpression('surprised');
    expect(p.eyeOpen).toBeGreaterThan(1);
    expect(p.lidClose).toBeLessThan(0);
  });
});
