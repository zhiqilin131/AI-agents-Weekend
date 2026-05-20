import type { SlimeAdvisorState } from '../../../app/components/report/slimeAdvisorTypes';
import type { SlimeProfile } from '../../../app/model';
import type { SlimeType } from '../slimeIdentity';
import { slimeSceneYOffset, type SlimeVisualVariant } from './slime3dConfig';
import { SlimeMesh } from './SlimeMesh';
import { BuddyStageEnvironment } from './variants/BuddyStageEnvironment';
import { MinimalBackdrop } from './variants/MinimalBackdrop';
import { StudioDeskScene, type StudioAura } from './variants/StudioDeskScene';
import type * as THREE from 'three';

export type SlimeSceneContentProps = {
  state: SlimeAdvisorState;
  slimeType: SlimeType;
  profile: SlimeProfile;
  variant: SlimeVisualVariant;
  speakAmplitude?: number;
  gooBurstKey?: number;
  mouthRef?: React.RefObject<THREE.Group | null>;
  studioAura?: StudioAura;
  studioAccent?: string;
};

export function SlimeSceneContent({
  state,
  slimeType,
  profile,
  variant,
  speakAmplitude,
  gooBurstKey,
  mouthRef,
  studioAura,
  studioAccent,
}: SlimeSceneContentProps) {
  return (
    <>
      {variant === 'hero' || variant === 'buddyHero' ? (
        <BuddyStageEnvironment slimeType={slimeType} />
      ) : null}
      {variant === 'studio' ? (
        <StudioDeskScene slimeType={slimeType} aura={studioAura} accent={studioAccent} />
      ) : null}
      {variant === 'chip' || variant === 'inline' ? <MinimalBackdrop slimeType={slimeType} /> : null}
      <group position={[0, (variant === 'studio' ? 0.05 : 0) + slimeSceneYOffset(variant), 0]}>
        <SlimeMesh
          state={state}
          slimeType={slimeType}
          profile={profile}
          variant={variant}
          speakAmplitude={speakAmplitude}
          gooBurstKey={gooBurstKey}
          mouthRef={mouthRef}
        />
      </group>
    </>
  );
}
