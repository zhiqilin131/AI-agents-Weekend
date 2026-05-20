import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { cn } from '../../../app/components/ui/utils';
import type { SlimeAdvisorProps } from '../../../app/components/report/slimeAdvisorTypes';
import { DEFAULT_SLIME_PROFILE } from '../../../hooks/useSlimeProfile';
import {
  cameraForVariant,
  dprForVariant,
  slimeCanvasLayout,
  slimeVariantFromProps,
  type SlimeVisualVariant,
} from './slime3dConfig';
import { SlimeSceneContent } from './SlimeSceneContent';
import type { StudioAura } from './variants/StudioDeskScene';

export type SlimeAdvisor3DProps = SlimeAdvisorProps & {
  variant?: SlimeVisualVariant;
  studioAura?: StudioAura;
  studioAccent?: string;
  onMouthAnchor?: (anchor: { clientX: number; clientY: number }) => void;
};

function MouthAnchorReporter({
  mouthRef,
  onMouthAnchor,
}: {
  mouthRef: React.RefObject<THREE.Group | null>;
  onMouthAnchor?: (anchor: { clientX: number; clientY: number }) => void;
}) {
  const { camera, gl } = useThree();
  const last = useRef('');

  useFrame(() => {
    if (!mouthRef.current || !onMouthAnchor) return;
    const v = new THREE.Vector3();
    mouthRef.current.getWorldPosition(v);
    v.project(camera);
    const rect = gl.domElement.getBoundingClientRect();
    const clientX = rect.left + ((v.x + 1) / 2) * rect.width;
    const clientY = rect.top + ((1 - v.y) / 2) * rect.height;
    const key = `${Math.round(clientX)}:${Math.round(clientY)}`;
    if (key !== last.current) {
      last.current = key;
      onMouthAnchor({ clientX, clientY });
    }
  });
  return null;
}

function SlimeCanvasInner({
  props,
  variant,
  mouthRef,
}: {
  props: SlimeAdvisor3DProps;
  variant: SlimeVisualVariant;
  mouthRef: React.RefObject<THREE.Group | null>;
}) {
  const state = props.state ?? 'idle';
  const profile = props.profile ?? DEFAULT_SLIME_PROFILE;
  const slimeType = props.slimeType ?? 'generalized';

  return (
    <>
      <SlimeSceneContent
        state={state}
        slimeType={slimeType}
        profile={profile}
        variant={variant}
        speakAmplitude={props.speakAmplitude}
        gooBurstKey={props.gooBurstKey}
        mouthRef={mouthRef}
        studioAura={props.studioAura}
        studioAccent={props.studioAccent}
      />
      {props.onMouthAnchor ? (
        <MouthAnchorReporter mouthRef={mouthRef} onMouthAnchor={props.onMouthAnchor} />
      ) : null}
    </>
  );
}

export function SlimeAdvisor3D(allProps: SlimeAdvisor3DProps) {
  const {
    state = 'idle',
    size = 'md',
    className,
    profile,
    slimeType = 'generalized',
    companionMode = false,
    buddyPage = false,
    studioScene = false,
    variant: variantProp,
  } = allProps;

  const p = profile ?? DEFAULT_SLIME_PROFILE;
  const variant = variantProp ?? slimeVariantFromProps({ size, companionMode, buddyPage, studioScene });
  const { spread, px } = slimeCanvasLayout(size, variant);
  const cam = cameraForVariant(variant);
  const mouthRef = useRef<THREE.Group | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [frameloop, setFrameloop] = useState<'always' | 'demand'>(
    variant === 'chip' ? 'demand' : 'always',
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || variant === 'hero' || variant === 'buddyHero') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry?.isIntersecting ?? true);
        setFrameloop(entry?.isIntersecting ? 'always' : 'demand');
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [variant]);

  return (
    <div
      ref={containerRef}
      className={cn('relative flex items-center justify-center overflow-visible', className)}
      style={{ width: spread, height: spread }}
      data-slime-state={state}
      data-testid="slime-advisor"
      data-slime-render="3d"
    >
      <Canvas
        className="bg-transparent"
        dpr={dprForVariant(variant)}
        frameloop={visible ? frameloop : 'demand'}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
          stencil: false,
        }}
        camera={{ position: cam.position, fov: cam.fov }}
        style={{ width: px, height: px, touchAction: 'none', background: 'transparent' }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2.5));
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = variant === 'hero' || variant === 'buddyHero' ? 1.22 : 1.12;
        }}
      >
        <Suspense fallback={null}>
          <SlimeCanvasInner props={allProps} variant={variant} mouthRef={mouthRef} />
        </Suspense>
      </Canvas>
    </div>
  );
}
