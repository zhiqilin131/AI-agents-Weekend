import { ContactShadows } from '@react-three/drei';
import type { SlimeType } from '../../slimeIdentity';

/** Buddy stage — neutral white for Mochi, soft blush for Rimumu. */
export function BuddyStageEnvironment({ slimeType }: { slimeType: SlimeType }) {
  const pink = slimeType === 'wellbeing';
  const key = pink ? '#fff8fa' : '#f0f7ff';
  const fill = pink ? '#ffe8f2' : '#bfdbfe';
  const rim = pink ? '#ffd6e8' : '#60a5fa';

  return (
    <>
      <ambientLight intensity={0.62} color={key} />
      <directionalLight position={[2, 5, 3]} intensity={0.9} color={key} />
      <directionalLight position={[-2, 2, 2]} intensity={0.28} color={fill} />
      <directionalLight position={[0, 1, -3]} intensity={0.22} color={rim} />
      <ContactShadows
        position={[0, -0.48, 0]}
        opacity={0.26}
        scale={2}
        blur={2.8}
        far={0.85}
        color={pink ? '#d4a5b8' : '#94a3b8'}
        frames={1}
      />
    </>
  );
}
