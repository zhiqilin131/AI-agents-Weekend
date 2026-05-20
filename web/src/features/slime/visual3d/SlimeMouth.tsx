import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SlimeAdvisorState } from '../../../app/components/report/slimeAdvisorTypes';
import { catMouthBezierCurves3 } from '../slimeMouthShape';
import { eyeExpressionFromState } from './slimeEyeExpression';
import { createObsidianMaterial } from './obsidianFaceMaterial';
import {
  MOUTH_CLOSED_EPS,
  mouthOpenTarget,
  stepMouthOpenSmooth,
} from './slimeMouthTalk';

export type SlimeFaceMotionRef = React.RefObject<{
  blinkPhase: number;
  eyeScale: number;
  listen: number;
  stateSpeaking: boolean;
  mouthOpen: number;
}>;

export type SlimeMouthProps = {
  faceWidth: number;
  state: SlimeAdvisorState;
  motionRef: SlimeFaceMotionRef;
};

const TUBE_RADIUS = 0.0034;
const TUBE_SEGMENTS = 14;

/** Obsidian cat mouth — closed ω at rest; TTS envelope opens a soft inner cavity. */
export function SlimeMouth({ faceWidth, state, motionRef }: SlimeMouthProps) {
  const groupRef = useRef<THREE.Group>(null);
  const lipsRef = useRef<THREE.Group>(null);
  const cavityRef = useRef<THREE.Mesh>(null);
  const smoothOpenRef = useRef(0);
  const mouthMat = useMemo(() => createObsidianMaterial(), []);
  const cavityMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#0a0a12'),
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      }),
    [],
  );

  const [leftGeo, rightGeo] = useMemo(() => {
    const { left, right } = catMouthBezierCurves3(faceWidth);
    return [
      new THREE.TubeGeometry(left, TUBE_SEGMENTS, TUBE_RADIUS, 6, false),
      new THREE.TubeGeometry(right, TUBE_SEGMENTS, TUBE_RADIUS, 6, false),
    ];
  }, [faceWidth]);

  const cavityGeo = useMemo(
    () => new THREE.SphereGeometry(faceWidth * 0.11, 20, 14),
    [faceWidth],
  );

  useFrame(() => {
    if (!groupRef.current || !lipsRef.current) return;
    const { stateSpeaking, mouthOpen } = motionRef.current;
    const surprised = eyeExpressionFromState(state) === 'surprised';
    const target = mouthOpenTarget(stateSpeaking, mouthOpen, surprised);
    const open = stepMouthOpenSmooth(smoothOpenRef.current, target);
    smoothOpenRef.current = open;

    const lipSpread = open * 0.028;
    const lipPinch = 1 - open * 0.22;
    lipsRef.current.position.set(0, lipSpread * 0.35, 0.02);
    lipsRef.current.scale.set(1 + open * 0.05, lipPinch, 1);

    if (cavityRef.current) {
      const show = open > MOUTH_CLOSED_EPS;
      cavityRef.current.visible = show;
      if (show) {
        const w = faceWidth * (0.1 + open * 0.06);
        const h = faceWidth * (0.04 + open * 0.11);
        cavityRef.current.scale.set(w / (faceWidth * 0.11), h / (faceWidth * 0.11), 0.35);
        cavityRef.current.position.set(0, -open * faceWidth * 0.07, 0.018);
        cavityMat.opacity = 0.55 + open * 0.38;
      }
    }

    if (!stateSpeaking && open < MOUTH_CLOSED_EPS) {
      groupRef.current.scale.set(1, 1, 1);
      smoothOpenRef.current = 0;
    }
  });

  return (
    <group ref={groupRef}>
      <group ref={lipsRef}>
        <mesh geometry={leftGeo} material={mouthMat} renderOrder={20} />
        <mesh geometry={rightGeo} material={mouthMat} renderOrder={20} />
      </group>
      <mesh
        ref={cavityRef}
        geometry={cavityGeo}
        material={cavityMat}
        visible={false}
        renderOrder={19}
      />
    </group>
  );
}
