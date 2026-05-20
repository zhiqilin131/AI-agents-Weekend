import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SLIME_BLOB_RADIUS, createRoundSlimeGeometry } from './mascotGeometry';

describe('createRoundSlimeGeometry', () => {
  it('is a sphere with uniform radius', () => {
    const geo = createRoundSlimeGeometry();
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const r0 = Math.sqrt(
      pos.getX(0) * pos.getX(0) + pos.getY(0) * pos.getY(0) + pos.getZ(0) * pos.getZ(0),
    );
    for (let i = 1; i < Math.min(pos.count, 80); i++) {
      const r = Math.sqrt(
        pos.getX(i) * pos.getX(i) + pos.getY(i) * pos.getY(i) + pos.getZ(i) * pos.getZ(i),
      );
      expect(Math.abs(r - r0)).toBeLessThan(0.02);
    }
    expect(r0).toBeCloseTo(SLIME_BLOB_RADIUS, 1);
  });
});
