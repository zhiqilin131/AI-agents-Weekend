import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import type { SlimeType } from '../../slimeIdentity';
import { mascotPaletteFor } from '../mascotPalette';

export function MinimalBackdrop({ slimeType }: { slimeType: SlimeType }) {
  const spotRef = useRef<THREE.Mesh | null>(null);
  const palette = mascotPaletteFor(slimeType);

  useFrame(({ clock }) => {
    if (!spotRef.current) return;
    const s = 1 + Math.sin(clock.getElapsedTime() * 1.2) * 0.06;
    spotRef.current.scale.set(s, s, 1);
  });

  const pink = slimeType === 'wellbeing';

  return (
    <>
      <ambientLight intensity={0.65} color={pink ? '#fff8fa' : '#ffffff'} />
      <directionalLight position={[2, 4, 3]} intensity={1.1} color={pink ? '#fff5f8' : '#ffffff'} />
      <directionalLight position={[-2, 1, 2]} intensity={0.3} color={pink ? '#ffe8f0' : '#ffffff'} />
      <mesh ref={spotRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.55, 0]}>
        <circleGeometry args={[0.55, 32]} />
        <meshBasicMaterial color={palette.bodyColor} transparent opacity={0.1} />
      </mesh>
    </>
  );
}
