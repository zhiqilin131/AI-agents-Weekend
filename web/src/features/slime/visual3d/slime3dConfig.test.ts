import { describe, expect, it } from 'vitest';
import { parseSlime3DFlag } from './slime3dConfig';

describe('parseSlime3DFlag', () => {
  it('defaults on for production when env unset', () => {
    expect(parseSlime3DFlag(undefined, true)).toBe(true);
  });

  it('defaults off for local dev when env unset', () => {
    expect(parseSlime3DFlag(undefined, false)).toBe(false);
  });

  it('respects explicit enable', () => {
    expect(parseSlime3DFlag('1', false)).toBe(true);
    expect(parseSlime3DFlag('true', false)).toBe(true);
  });

  it('respects explicit disable', () => {
    expect(parseSlime3DFlag('0', true)).toBe(false);
    expect(parseSlime3DFlag('false', true)).toBe(false);
  });
});
