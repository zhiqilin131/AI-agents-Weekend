import { useMemo } from 'react';
import * as THREE from 'three';

export type SesameSlimeEyeProps = {
  width: number;
  height: number;
};

const BLACK = new THREE.MeshBasicMaterial({
  color: '#000000',
  toneMapped: false,
  depthWrite: true,
  depthTest: true,
});

/**
 * Single flat black sesame — no circleGeometry pad, no billboard (no blue halo).
 */
export function SesameSlimeEye({ width, height }: SesameSlimeEyeProps) {
  const geo = useMemo(() => new THREE.SphereGeometry(1, 12, 12), []);

  return (
    <mesh
      geometry={geo}
      material={BLACK}
      scale={[width, height, 0.35]}
      renderOrder={30}
      position={[0, 0, 0.04]}
    />
  );
}
