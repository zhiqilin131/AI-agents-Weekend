import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import type { SlimeAdvisorState } from '../../../app/components/report/slimeAdvisorTypes';
import type { SlimeType } from '../slimeIdentity';
import { mascotFaceLayout } from './mascotFaceLayout';
import { SlimeCheekBlush } from './SlimeCheekBlush';
import { SesameSlimeEye } from './SesameSlimeEye';
import { SlimeMouth, type SlimeFaceMotionRef } from './SlimeMouth';
import {
  eyeExpressionFromState,
  eyeParamsForExpression,
} from './slimeEyeExpression';

export type { SlimeFaceMotionRef };

export type SlimeFaceProps = {
  state: SlimeAdvisorState;
  slimeType: SlimeType;
  motionRef: SlimeFaceMotionRef;
  mouthRef?: React.RefObject<THREE.Group | null>;
};

export function SlimeFace({ state, slimeType, motionRef, mouthRef }: SlimeFaceProps) {
  const layout = useMemo(() => mascotFaceLayout(), []);
  const cheekY = layout.eyeY - 0.062;
  const cheekX = layout.eyeSpacing * 0.72 + 0.026;
  const cheekZ = layout.eyeZ - 0.006;
  const leftEyeRef = useRef<THREE.Group>(null);
  const rightEyeRef = useRef<THREE.Group>(null);
  const innerMouthRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const { blinkPhase, eyeScale, listen } = motionRef.current;
    const expr = eyeExpressionFromState(state);
    const params = eyeParamsForExpression(expr, listen);
    const blink = blinkPhase > 0.86 && blinkPhase < 0.92;
    const blinkSquash = blink ? 0.15 : 1;
    const scale = params.eyeScale * eyeScale;

    for (const ref of [leftEyeRef, rightEyeRef]) {
      if (ref.current) {
        ref.current.scale.set(scale, scale * blinkSquash, scale);
      }
    }
  });

  const resolvedMouthRef = mouthRef ?? innerMouthRef;

  return (
    <group renderOrder={30}>
      <SlimeCheekBlush slimeType={slimeType} x={-cheekX} y={cheekY} z={cheekZ} />
      <SlimeCheekBlush slimeType={slimeType} x={cheekX} y={cheekY} z={cheekZ} />
      <group ref={leftEyeRef} position={[-layout.eyeSpacing, layout.eyeY, layout.eyeZ]}>
        <SesameSlimeEye width={layout.eyeWidth} height={layout.eyeHeight} />
      </group>
      <group ref={rightEyeRef} position={[layout.eyeSpacing, layout.eyeY, layout.eyeZ]}>
        <SesameSlimeEye width={layout.eyeWidth} height={layout.eyeHeight} />
      </group>
      <group ref={resolvedMouthRef} position={[0, layout.mouthY, layout.eyeZ - 0.01]}>
        <SlimeMouth faceWidth={layout.faceWidth} state={state} motionRef={motionRef} />
      </group>
    </group>
  );
}
