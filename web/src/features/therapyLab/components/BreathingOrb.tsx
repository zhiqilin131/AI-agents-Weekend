import { motion } from 'motion/react';
import { memo, useEffect } from 'react';
import { therapyLabTheme } from './TherapyLabChrome';

export type BreathingPhaseId = 'inhale' | 'hold_in' | 'exhale' | 'hold_out';

const ORB_SIZE = 148;
const SCALE_MIN = 0.62;
const SCALE_MAX = 1;

const t = therapyLabTheme;

type BreathingOrbProps = {
  phaseId: BreathingPhaseId;
  phaseSeconds: number;
  paused?: boolean;
  /** Test/debug hook to count real render commits. */
  onRender?: () => void;
};

export const BreathingOrb = memo(function BreathingOrb({
  phaseId,
  phaseSeconds,
  paused = false,
  onRender,
}: BreathingOrbProps) {
  const expanded = phaseId === 'inhale' || phaseId === 'hold_in';
  const targetScale = expanded ? SCALE_MAX : SCALE_MIN;
  const isHold = phaseId === 'hold_in' || phaseId === 'hold_out';
  const animateDuration = paused || isHold ? 0 : phaseSeconds;

  useEffect(() => {
    onRender?.();
  });

  const initialScale = phaseId === 'inhale' ? SCALE_MIN : phaseId === 'exhale' ? SCALE_MAX : targetScale;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative flex items-center justify-center"
        style={{ width: ORB_SIZE * SCALE_MAX + 48, height: ORB_SIZE * SCALE_MAX + 48 }}
      >
        {/* Ambient halo — follows orb scale */}
        <motion.div
          className="pointer-events-none absolute rounded-full"
          style={{
            width: ORB_SIZE + 24,
            height: ORB_SIZE + 24,
            background: `radial-gradient(circle, ${t.accent}30 0%, ${t.glow} 45%, transparent 72%)`,
            filter: 'blur(14px)',
          }}
          animate={{ scale: targetScale * 1.08 }}
          transition={{ duration: animateDuration, ease: [0.45, 0.05, 0.55, 0.95] }}
        />

        {/* Ground shadow */}
        <motion.div
          className="pointer-events-none absolute bottom-6 rounded-[50%]"
          style={{
            width: ORB_SIZE * 0.72,
            height: 18,
            background: 'rgba(158, 74, 90, 0.14)',
            filter: 'blur(10px)',
          }}
          animate={{ scale: targetScale * 0.95, opacity: expanded ? 0.5 : 0.32 }}
          transition={{ duration: animateDuration, ease: [0.45, 0.05, 0.55, 0.95] }}
        />

        {/* Main breathing orb */}
        <motion.div
          className="relative flex items-center justify-center rounded-full"
          style={{ width: ORB_SIZE, height: ORB_SIZE }}
          initial={{ scale: initialScale }}
          animate={{ scale: targetScale }}
          transition={{ duration: animateDuration, ease: [0.45, 0.05, 0.55, 0.95] }}
        >
          {/* Outer rim */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `linear-gradient(145deg, ${t.highlight} 0%, ${t.secondary} 38%, ${t.primary} 72%, ${t.deep} 100%)`,
              boxShadow: `
                0 14px 36px ${t.ctaGlow},
                0 4px 12px rgba(158, 74, 90, 0.12),
                inset 0 2px 8px rgba(255, 255, 255, 0.55),
                inset 0 -6px 16px rgba(142, 42, 64, 0.18)
              `,
            }}
          />

          {/* Inner body depth */}
          <div
            className="absolute inset-[6px] rounded-full"
            style={{
              background: `radial-gradient(circle at 38% 32%, rgba(255,255,255,0.92) 0%, ${t.highlight} 18%, ${t.accent} 52%, ${t.primary} 88%)`,
            }}
          />

          {/* Specular highlight */}
          <div
            className="pointer-events-none absolute rounded-full"
            style={{
              width: '42%',
              height: '28%',
              left: '22%',
              top: '16%',
              background: 'linear-gradient(160deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.15) 100%)',
              filter: 'blur(1px)',
            }}
          />

          {/* Soft core glow */}
          <div
            className="pointer-events-none absolute inset-[28%] rounded-full opacity-70"
            style={{
              background: `radial-gradient(circle, rgba(255,255,255,0.5) 0%, ${t.accent}44 55%, transparent 100%)`,
            }}
          />

        </motion.div>
      </div>
    </div>
  );
});

export const BREATHING_PATTERN = [
  { id: 'inhale' as const, label: 'Inhale', seconds: 4 },
  { id: 'hold_in' as const, label: 'Hold', seconds: 2 },
  { id: 'exhale' as const, label: 'Exhale', seconds: 6 },
  { id: 'hold_out' as const, label: 'Hold', seconds: 2 },
] as const;

export const BREATHING_CYCLE_SECONDS = BREATHING_PATTERN.reduce((s, p) => s + p.seconds, 0);
