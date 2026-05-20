import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SlimeAdvisorState } from '../../../app/components/report/slimeAdvisorTypes';
import type { SlimeProfile } from '../../../app/model';
import type { SlimeType } from '../slimeIdentity';
import { SlimeBodyMesh, slimeBodyScaleFor, useSlimeBodyMaterial } from './SlimeBodyMesh';
import { SlimeFace, type SlimeFaceMotionRef } from './SlimeFace';
import { SlimeIdleGooSplatter } from './SlimeIdleGooSplatter';
import { slimeMotionUniforms } from './slimeMotionBridge';
import { displayScaleForVariant, type SlimeVisualVariant } from './slime3dConfig';

export type SlimeMeshProps = {
  state: SlimeAdvisorState;
  slimeType: SlimeType;
  profile: SlimeProfile;
  variant?: SlimeVisualVariant;
  speakAmplitude?: number;
  mouthRef?: React.RefObject<THREE.Group | null>;
  /** Increments trigger idle goo splatter + body jiggle. */
  gooBurstKey?: number;
};

export function SlimeMesh({
  state,
  slimeType,
  profile,
  variant = 'inline',
  speakAmplitude = 0,
  mouthRef,
  gooBurstKey = 0,
}: SlimeMeshProps) {
  const bodyRef = useRef<THREE.Group>(null);
  const innerBreathRef = useRef<THREE.Group>(null);
  const { palette, shellMaterial, coreMaterial } = useSlimeBodyMaterial(slimeType);
  const bodyScale = useMemo(() => slimeBodyScaleFor(slimeType, profile), [slimeType, profile]);
  const displayScale = displayScaleForVariant(variant);
  const isSpeaking = state === 'speaking';

  const motionRef = useRef({
    blinkPhase: 0,
    eyeScale: 1,
    listen: 0,
    stateSpeaking: false,
    mouthOpen: 0.1,
  }) as SlimeFaceMotionRef;
  const gooBurstStart = useRef(-1);
  const prevGooBurstKey = useRef(0);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (gooBurstKey !== prevGooBurstKey.current) {
      gooBurstStart.current = t;
      prevGooBurstKey.current = gooBurstKey;
    }
    const u = slimeMotionUniforms(state, slimeType, profile, t, speakAmplitude);
    const burstElapsed =
      gooBurstKey > 0 && gooBurstStart.current >= 0 ? t - gooBurstStart.current : 999;
    const burstActive = burstElapsed >= 0 && burstElapsed < 0.55;
    const burstJiggle = burstActive ? Math.sin(burstElapsed * 38) * (1 - burstElapsed / 0.55) * 0.09 : 0;

    motionRef.current = {
      blinkPhase: u.blinkPhase,
      eyeScale: u.eyeScale,
      listen: u.listen,
      stateSpeaking: isSpeaking,
      mouthOpen: u.mouthOpen,
    };
    shellMaterial.uniforms.uTime!.value = t;
    shellMaterial.uniforms.uSquashY!.value = u.squashY;
    shellMaterial.uniforms.uSquashX!.value = u.squashX;
    shellMaterial.uniforms.uVertexWobble!.value = u.vertexWobble;
    coreMaterial.uniforms.uTime!.value = t;
    coreMaterial.uniforms.uPulse!.value =
      u.innerPulse +
      (isSpeaking ? speakAmplitude * 0.42 : 0) +
      Math.sin(t * 0.81 + 0.9) * 0.12 +
      Math.sin(t * 0.47) * 0.08;
    if (innerBreathRef.current) {
      innerBreathRef.current.scale.set(u.innerSquashX, u.innerSquashY, u.innerSquashX);
    }
    if (bodyRef.current) {
      const [sx, sy, sz] = bodyScale;
      const jx = 1 + burstJiggle;
      const jy = 1 - burstJiggle * 0.65;
      bodyRef.current.scale.set(sx * displayScale * jx, sy * displayScale * jy, sz * displayScale * jx);
      bodyRef.current.rotation.z = burstActive
        ? Math.sin(burstElapsed * 42) * 0.06 * (1 - burstElapsed / 0.55)
        : 0;
    }
  });

  const accessory = profile.accessory;

  return (
    <group>
      <SlimeBodyMesh
        slimeType={slimeType}
        profile={profile}
        bodyRef={bodyRef}
        innerBreathRef={innerBreathRef}
        shellMaterial={shellMaterial}
        coreMaterial={coreMaterial}
      />
      <SlimeIdleGooSplatter burstKey={gooBurstKey} slimeType={slimeType} bodyScale={displayScale} />
      <SlimeFace state={state} slimeType={slimeType} motionRef={motionRef} mouthRef={mouthRef} />
      {accessory === 'antenna' ? (
        <group position={[0, 0.38 * displayScale, 0.05]}>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.01, 0.01, 0.16, 8]} />
            <meshBasicMaterial color="#f8fafc" />
          </mesh>
          <mesh position={[0, 0.24, 0]}>
            <sphereGeometry args={[0.03, 12, 12]} />
            <meshBasicMaterial color={palette.bodyColor} />
          </mesh>
        </group>
      ) : null}
      {accessory === 'halo' && slimeType !== 'wellbeing' ? (
        <mesh position={[0, 0.42 * displayScale, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.16, 0.014, 8, 32]} />
          <meshBasicMaterial color="#facc15" transparent opacity={0.55} />
        </mesh>
      ) : null}
    </group>
  );
}
