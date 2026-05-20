import * as THREE from 'three';
import { SLIME_BODY_SEGMENTS } from './slime3dConfig';

/** Shared round blob — Mochi and Rimumu use identical sphere body. */
export const SLIME_BLOB_RADIUS = 0.42;
/** Outer shell — another 10% less flat than [1.097, 0.919, 1.097]. */
export const SLIME_BLOB_SCALE: [number, number, number] = [1.087, 0.927, 1.087];

export function createRoundSlimeGeometry(): THREE.SphereGeometry {
  const geo = new THREE.SphereGeometry(SLIME_BLOB_RADIUS, SLIME_BODY_SEGMENTS, SLIME_BODY_SEGMENTS);
  geo.computeVertexNormals();
  return geo;
}

export function slimeBlobScale(): [number, number, number] {
  return SLIME_BLOB_SCALE;
}
