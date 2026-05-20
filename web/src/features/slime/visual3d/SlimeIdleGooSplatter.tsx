import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SlimeType } from '../slimeIdentity';
import { SLIME_BLOB_RADIUS, SLIME_BLOB_SCALE } from './mascotGeometry';
import { boostInnerSaturation, mascotPaletteFor } from './mascotPalette';

const DROP_COUNT = 8;
const BURST_DURATION = 1.15;
const DROP_BASE_RADIUS = 0.036;

type Droplet = {
  ox: number;
  oy: number;
  oz: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  birth: number;
};

export type SlimeIdleGooSplatterProps = {
  burstKey: number;
  slimeType: SlimeType;
  bodyScale: number;
};

function shellRadii(displayScale: number): { x: number; y: number; z: number } {
  return {
    x: SLIME_BLOB_RADIUS * SLIME_BLOB_SCALE[0] * displayScale,
    y: SLIME_BLOB_RADIUS * SLIME_BLOB_SCALE[1] * displayScale,
    z: SLIME_BLOB_RADIUS * SLIME_BLOB_SCALE[2] * displayScale,
  };
}

/** Inner core mid tone — matches SlimeCoreFlowMaterial uFlowA. */
function innerGooColor(slimeType: SlimeType): THREE.Color {
  const { inner } = mascotPaletteFor(slimeType);
  const v = boostInnerSaturation(inner.mid.clone(), 1.42);
  return new THREE.Color(v.x, v.y, v.z);
}

/**
 * Spawn on outer shell — evenly around 360° (theta) and lower/mid-lower bands (phi).
 */
function spawnOnShellSurface(
  r: { x: number; y: number; z: number },
  index: number,
  total: number,
): Omit<Droplet, 'birth'> {
  const theta = (index / total) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
  const band = index % 4;
  const phi =
    band === 0
      ? Math.PI * (0.46 + Math.random() * 0.08)
      : band === 1
        ? Math.PI * (0.56 + Math.random() * 0.1)
        : band === 2
          ? Math.PI * (0.66 + Math.random() * 0.1)
          : Math.PI * (0.76 + Math.random() * 0.12);

  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const ox = r.x * sinP * cosT;
  const oy = r.y * cosP;
  const oz = r.z * sinP * sinT;

  const nx = (sinP * cosT) / r.x;
  const ny = cosP / r.y;
  const nz = (sinP * sinT) / r.z;
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const nux = nx / nLen;
  const nuy = ny / nLen;
  const nuz = nz / nLen;

  const peel = 0.05 + Math.random() * 0.06;
  return {
    ox,
    oy,
    oz,
    vx: nux * peel + (Math.random() - 0.5) * 0.025,
    vy: nuy * peel * 0.25 - 0.05 - Math.random() * 0.04,
    vz: nuz * peel + (Math.random() - 0.5) * 0.025,
    scale: 1.0 + Math.random() * 0.28,
  };
}

/** Idle shake — round goo beads peel from the shell all around the body. */
export function SlimeIdleGooSplatter({ burstKey, slimeType, bodyScale }: SlimeIdleGooSplatterProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dropletsRef = useRef<Droplet[]>([]);
  const lastBurst = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const shell = useMemo(() => shellRadii(bodyScale), [bodyScale]);

  const gooColor = useMemo(() => innerGooColor(slimeType), [slimeType]);

  const geometry = useMemo(() => new THREE.SphereGeometry(DROP_BASE_RADIUS, 14, 14), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: gooColor,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        toneMapped: false,
      }),
    [gooColor],
  );

  useLayoutEffect(() => {
    material.color.copy(gooColor);
  }, [material, gooColor]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.getElapsedTime();

    if (burstKey > 0 && burstKey !== lastBurst.current) {
      lastBurst.current = burstKey;
      const drops: Droplet[] = [];
      for (let i = 0; i < DROP_COUNT; i += 1) {
        drops.push({
          ...spawnOnShellSurface(shell, i, DROP_COUNT),
          birth: t,
        });
      }
      dropletsRef.current = drops;
    }

    let anyVisible = false;
    for (let i = 0; i < DROP_COUNT; i += 1) {
      const d = dropletsRef.current[i];
      if (!d) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const age = t - d.birth;
      if (age > BURST_DURATION) {
        dummy.scale.setScalar(0);
      } else {
        const gravity = age * age * 0.22;
        const drag = 1 - Math.min(age * 0.85, 0.55);
        dummy.position.set(
          d.ox + d.vx * age * drag,
          d.oy + d.vy * age * drag - gravity,
          d.oz + d.vz * age * drag,
        );
        const fade = 1 - age / BURST_DURATION;
        const s = d.scale * fade;
        dummy.scale.set(s, s, s);
        anyVisible = true;
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = anyVisible;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, DROP_COUNT]}
      frustumCulled={false}
      renderOrder={3}
      visible={false}
    />
  );
}
