import { useMemo } from 'react';
import * as THREE from 'three';
import type { SlimeType } from '../slimeIdentity';

const BLUSH_GEOMETRY = new THREE.SphereGeometry(0.02, 12, 10);

function blushTint(slimeType: SlimeType): THREE.Color {
  return new THREE.Color(slimeType === 'wellbeing' ? '#ff8fb8' : '#ffb3cc');
}

export type SlimeCheekBlushProps = {
  slimeType: SlimeType;
  x: number;
  y: number;
  z: number;
};

/** Soft oval blush under the eyes (unlit so it stays a light cute pink). */
export function SlimeCheekBlush({ slimeType, x, y, z }: SlimeCheekBlushProps) {
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: blushTint(slimeType),
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        toneMapped: false,
      }),
    [slimeType],
  );

  return (
    <mesh
      geometry={BLUSH_GEOMETRY}
      material={material}
      position={[x, y, z]}
      scale={[1.4, 0.72, 0.38]}
      renderOrder={25}
    />
  );
}
