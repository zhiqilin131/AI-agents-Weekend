import { useMemo } from 'react';
import * as THREE from 'three';
import { SESAME_EYE_COLOR, SESAME_EYE_OPACITY } from './sesameEyeStyle';

export type SesameSlimeEyeProps = {
  width: number;
  height: number;
};

const SESAME_MATERIAL = new THREE.MeshBasicMaterial({
  color: SESAME_EYE_COLOR,
  opacity: SESAME_EYE_OPACITY,
  transparent: true,
  toneMapped: false,
  depthWrite: false,
  depthTest: true,
});

/**
 * Flat sesame seed — squashed sphere, slight gray-brown tint + 10% transparency.
 */
export function SesameSlimeEye({ width, height }: SesameSlimeEyeProps) {
  const geo = useMemo(() => new THREE.SphereGeometry(1, 12, 12), []);

  return (
    <mesh
      geometry={geo}
      material={SESAME_MATERIAL}
      scale={[width, height, 0.35]}
      renderOrder={30}
      position={[0, 0, 0.04]}
    />
  );
}
