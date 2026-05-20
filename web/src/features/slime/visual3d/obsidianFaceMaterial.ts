import * as THREE from 'three';

/** Matte obsidian — no env/clearcoat so Mochi blue lights cannot halo the eyes. */
export const OBSIDIAN_COLOR = '#040408';

export function createObsidianMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: OBSIDIAN_COLOR,
    toneMapped: false,
    depthWrite: true,
    depthTest: true,
  });
}
