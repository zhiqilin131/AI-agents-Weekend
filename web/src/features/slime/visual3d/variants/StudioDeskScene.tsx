import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SlimeType } from '../../slimeIdentity';
import { getSlimeIdentity } from '../../slimeIdentity';

export type StudioAura = 'soft' | 'scan' | 'questions' | 'rings' | 'spark' | 'error';

export function StudioDeskScene({
  slimeType,
  aura = 'soft',
  accent,
}: {
  slimeType: SlimeType;
  aura?: StudioAura;
  accent?: string;
}) {
  const ident = getSlimeIdentity(slimeType);
  const ringRef = useRef<THREE.Mesh>(null);
  const scanRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ringRef.current && aura === 'rings') {
      ringRef.current.scale.setScalar(1 + (t % 1) * 0.4);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.5 - (t % 1) * 0.45;
    }
    if (scanRef.current && aura === 'scan') {
      scanRef.current.position.y = -0.2 + ((t * 0.5) % 1) * 0.8;
    }
  });

  const glow = accent ?? ident.theme.accent;

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 3]} intensity={1} color="#fff" />
      <pointLight position={[0, 2, 1]} intensity={0.5} color={glow} />
      <mesh position={[0, -0.52, 0.15]} rotation={[-0.1, 0, 0]}>
        <boxGeometry args={[1.4, 0.08, 0.7]} />
        <meshStandardMaterial color={ident.theme.surface} roughness={0.75} />
      </mesh>
      <mesh position={[-0.35, -0.38, 0.35]} rotation={[-0.3, 0.2, 0.05]}>
        <boxGeometry args={[0.35, 0.02, 0.28]} />
        <meshStandardMaterial color="#fffef8" roughness={0.9} />
      </mesh>
      <mesh position={[0.32, -0.4, 0.32]} rotation={[-0.25, -0.15, 0]}>
        <boxGeometry args={[0.3, 0.02, 0.24]} />
        <meshStandardMaterial color="#fffef8" roughness={0.9} />
      </mesh>
      {aura === 'rings' ? (
        <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.35, 0.2]}>
          <ringGeometry args={[0.35, 0.5, 32]} />
          <meshBasicMaterial color={glow} transparent opacity={0.4} />
        </mesh>
      ) : null}
      {aura === 'scan' ? (
        <mesh ref={scanRef} position={[0, 0, 0.5]}>
          <planeGeometry args={[0.9, 0.04]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.45} />
        </mesh>
      ) : null}
      {aura === 'spark' ? (
        <group position={[0.5, -0.2, 0.45]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[i * 0.08, 0, 0]}>
              <sphereGeometry args={[0.03, 8, 8]} />
              <meshBasicMaterial color={glow} />
            </mesh>
          ))}
        </group>
      ) : null}
    </>
  );
}
