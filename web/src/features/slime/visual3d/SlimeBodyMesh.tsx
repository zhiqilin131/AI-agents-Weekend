import { useMemo } from 'react';
import * as THREE from 'three';
import type { SlimeType } from '../slimeIdentity';
import { createSlimeCoreFlowMaterial } from './SlimeCoreFlowMaterial';
import { createSlimeGooMaterial } from './SlimeGooMaterial';
import { SLIME_BLOB_SCALE, createRoundSlimeGeometry } from './mascotGeometry';
import { mascotPaletteFor } from './mascotPalette';
import type { SlimeProfile } from '../../../app/model';

export type SlimeBodyMeshProps = {
  slimeType: SlimeType;
  profile: SlimeProfile;
  bodyRef: React.RefObject<THREE.Group | null>;
  innerBreathRef: React.RefObject<THREE.Group | null>;
  shellMaterial: THREE.ShaderMaterial;
  coreMaterial: THREE.ShaderMaterial;
};

export function useSlimeBodyMaterial(slimeType: SlimeType) {
  const palette = useMemo(() => mascotPaletteFor(slimeType), [slimeType]);
  const shellMaterial = useMemo(() => createSlimeGooMaterial(palette), [palette]);
  const coreMaterial = useMemo(() => createSlimeCoreFlowMaterial(palette), [palette]);
  return { palette, shellMaterial, coreMaterial };
}

/** Inner core base scale vs outer shell radius (+5% from 0.688). */
export const SLIME_CORE_INNER_SCALE = 0.722;

/** Inner core shape — another 10% less flat than prior X/Z & Y multipliers. */
const CORE_FLAT_XZ = 0.965;
const CORE_FLAT_Y = 0.927;
export const SLIME_CORE_INNER_SCALE_XYZ: [number, number, number] = [
  SLIME_CORE_INNER_SCALE * CORE_FLAT_XZ,
  SLIME_CORE_INNER_SCALE * CORE_FLAT_Y,
  SLIME_CORE_INNER_SCALE * CORE_FLAT_XZ,
];

/** Layered jelly: inner core + gradient shell (same geometry for both). */
export function SlimeBodyMesh({ slimeType, bodyRef, innerBreathRef, shellMaterial, coreMaterial }: SlimeBodyMeshProps) {
  const geometry = useMemo(() => createRoundSlimeGeometry(), []);

  return (
    <group ref={bodyRef}>
      <group ref={innerBreathRef}>
        <mesh geometry={geometry} scale={SLIME_CORE_INNER_SCALE_XYZ} renderOrder={0}>
          <primitive object={coreMaterial} attach="material" />
        </mesh>
      </group>
      <mesh geometry={geometry} renderOrder={1}>
        <primitive object={shellMaterial} attach="material" />
      </mesh>
    </group>
  );
}

export function slimeBodyScaleFor(_slimeType: SlimeType, _profile: SlimeProfile): [number, number, number] {
  return SLIME_BLOB_SCALE;
}
