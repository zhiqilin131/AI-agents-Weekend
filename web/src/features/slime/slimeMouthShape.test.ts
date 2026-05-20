import { describe, expect, it } from 'vitest';
import {
  SLIME_CAT_MOUTH_FACE_FRAC,
  catMouthBezierCurves3,
  compactCatMouth,
  slimeCatMouthPathD,
} from './slimeMouthShape';

describe('compactCatMouth', () => {
  it('keeps mouth near 15% of face width', () => {
    const face = 36;
    const m = compactCatMouth(face);
    expect(m.halfW * 2).toBeCloseTo(face * SLIME_CAT_MOUTH_FACE_FRAC, 5);
  });
});

describe('slimeCatMouthPathD', () => {
  it('draws two short arcs with a center dip (not one wide smile)', () => {
    const d = slimeCatMouthPathD(50, 60, 36);
    const parts = d.split(' M');
    expect(parts).toHaveLength(2);
    const leftCtrlX = Number(parts[0].split(' Q')[1].split(' ')[0]);
    expect(leftCtrlX).toBeLessThan(50 - compactCatMouth(36).halfW);
    expect(d).toContain(`50 ${60 + compactCatMouth(36).centerDrop}`);
  });
});

describe('catMouthBezierCurves3', () => {
  it('places center below corners for compact cat mouth', () => {
    const { left } = catMouthBezierCurves3(0.226);
    expect(left.v2.y).toBeLessThan(left.v0.y);
    expect(left.v1.x).toBeLessThan(left.v0.x);
  });
});
