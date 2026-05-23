import { memo, useEffect } from 'react';

export type BreathingPhaseId = 'inhale' | 'hold_in' | 'exhale' | 'hold_out';

const ORB_SIZE = 210;
const SCALE_MIN = 0.55;
const SCALE_MAX = 1;
const RING_RADIUS = (ORB_SIZE + 18) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type BreathingOrbProps = {
  phaseId: BreathingPhaseId;
  phaseSeconds: number;
  paused?: boolean;
  /** Optional compatibility props for static-render tests. */
  countdown?: number;
  label?: string;
  /** Test/debug hook to count real render commits. */
  onRender?: () => void;
};

export const BreathingOrb = memo(function BreathingOrb({
  phaseId,
  phaseSeconds,
  paused = false,
  countdown,
  label,
  onRender,
}: BreathingOrbProps) {
  const isInhale = phaseId === 'inhale';
  const isHoldIn = phaseId === 'hold_in';
  const isExhale = phaseId === 'exhale';
  const isHoldOut = phaseId === 'hold_out';
  const isHold = phaseId === 'hold_in' || phaseId === 'hold_out';
  const targetScale = isInhale || isHoldIn ? SCALE_MAX : SCALE_MIN;
  const phaseHue = isInhale ? '#FF9FB0' : isHoldIn ? '#FFB8A0' : isExhale ? '#C692BC' : '#9B79A3';
  const auraOpacity = isInhale ? 0.85 : isHoldIn ? 0.95 : isExhale ? 0.45 : 0.32;
  const coreOpacity = isInhale ? 0.98 : isHoldIn ? 1 : isExhale ? 0.76 : 0.66;
  const coreSaturate = isInhale ? 1.05 : isHoldIn ? 1.08 : isExhale ? 0.88 : 0.82;
  const phaseEase = isInhale ? 'cubic-bezier(0.32, 0.0, 0.30, 1.0)' : 'cubic-bezier(0.45, 0.0, 0.28, 1.0)';
  const phaseDuration = paused || isHold ? 0 : phaseSeconds;
  const phaseWord = isInhale ? 'Inhale' : isHoldIn ? 'Hold' : isExhale ? 'Exhale' : 'Rest';
  const ringAnimation = !paused && !isHold ? `breath-ring-deplete ${phaseSeconds}s linear forwards` : undefined;

  useEffect(() => {
    onRender?.();
  });

  const innerGlowOpacity = Math.min(1, auraOpacity + 0.08);
  const stageStyle = {
    ['--breath-core-hot' as const]: '#FFF6F4',
    ['--breath-hue' as const]: phaseHue,
    ['--phase-duration' as const]: `${phaseDuration}s`,
    ['--phase-ease' as const]: phaseEase,
    ['--orb-scale' as const]: String(targetScale),
    ['--aura-opacity' as const]: String(auraOpacity),
    ['--inner-opacity' as const]: String(innerGlowOpacity),
    ['--core-opacity' as const]: String(coreOpacity),
    ['--core-saturate' as const]: String(coreSaturate),
    ['--ring-circumference' as const]: String(CIRCUMFERENCE),
  };

  return (
    <div
      className="breathing-orb-stage flex flex-col items-center gap-2"
      data-phase={phaseId}
      style={stageStyle}
      aria-live="polite"
      aria-label={`Breathing phase ${phaseWord}`}
    >
      <div
        className="breathing-orb-wrap relative flex items-center justify-center"
        style={{ width: ORB_SIZE * SCALE_MAX + 120, height: ORB_SIZE * SCALE_MAX + 120 }}
      >
        <div className="aura-outer pointer-events-none absolute rounded-full" style={{ width: ORB_SIZE + 126, height: ORB_SIZE + 126 }} />
        <div className="aura-inner pointer-events-none absolute rounded-full" style={{ width: ORB_SIZE + 66, height: ORB_SIZE + 66 }} />
        <div className="breathing-core relative flex items-center justify-center rounded-full" style={{ width: ORB_SIZE, height: ORB_SIZE }}>
          <div className="core-highlight pointer-events-none absolute rounded-full" />
        </div>
        <svg
          className="progress-ring pointer-events-none absolute"
          width={ORB_SIZE + 40}
          height={ORB_SIZE + 40}
          viewBox={`0 0 ${ORB_SIZE + 40} ${ORB_SIZE + 40}`}
          aria-hidden
        >
          <circle className="ring-track" cx={(ORB_SIZE + 40) / 2} cy={(ORB_SIZE + 40) / 2} r={RING_RADIUS} />
          <circle
            key={`${phaseId}-${phaseSeconds}-${paused ? 'paused' : 'active'}`}
            className={`ring-progress ${isHold ? 'is-hold' : ''}`}
            cx={(ORB_SIZE + 40) / 2}
            cy={(ORB_SIZE + 40) / 2}
            r={RING_RADIUS}
            style={{ animation: ringAnimation }}
          />
        </svg>
      </div>
      <p className="phase-word text-sm font-normal text-[var(--breath-label)]">{label ?? phaseWord}</p>
      {typeof countdown === 'number' ? <p className="countdown text-xs font-light text-[var(--breath-subtle)]">{countdown}</p> : null}
      <style>{`
        @property --breath-hue {
          syntax: '<color>';
          inherits: true;
          initial-value: #FF9FB0;
        }
        .breathing-orb-stage {
          --breath-label: rgba(255, 244, 246, 0.74);
          --breath-subtle: rgba(255, 244, 246, 0.34);
          transition: --breath-hue 1400ms cubic-bezier(0.22, 0.76, 0.24, 1);
        }
        .aura-outer,
        .aura-inner,
        .breathing-core {
          transform: scale(var(--orb-scale));
          will-change: transform, opacity, filter;
        }
        .aura-outer {
          background: radial-gradient(circle, color-mix(in oklab, var(--breath-hue) 52%, #FFF6F4) 0%, color-mix(in oklab, var(--breath-hue) 40%, transparent) 58%, transparent 86%);
          filter: blur(48px);
          opacity: calc(var(--aura-opacity) * 0.62);
          transition:
            transform calc(var(--phase-duration) + 0.35s) var(--phase-ease),
            opacity var(--phase-duration) var(--phase-ease),
            background 1400ms cubic-bezier(0.22, 0.76, 0.24, 1);
          transition-delay: 350ms;
        }
        .aura-inner {
          background: radial-gradient(circle, color-mix(in oklab, var(--breath-hue) 58%, #FFF6F4) 0%, color-mix(in oklab, var(--breath-hue) 48%, transparent) 62%, transparent 88%);
          filter: blur(20px);
          opacity: var(--inner-opacity);
          transition:
            transform var(--phase-duration) var(--phase-ease),
            opacity var(--phase-duration) var(--phase-ease),
            background 1400ms cubic-bezier(0.22, 0.76, 0.24, 1);
        }
        .breathing-core {
          background: radial-gradient(
            circle at 50% 45%,
            var(--breath-core-hot) 0%,
            color-mix(in oklab, var(--breath-hue) 72%, #FFF6F4) 30%,
            var(--breath-hue) 52%,
            color-mix(in oklab, var(--breath-hue) 58%, transparent) 74%,
            color-mix(in oklab, var(--breath-hue) 30%, transparent) 88%,
            transparent 100%
          );
          opacity: var(--core-opacity);
          filter: saturate(var(--core-saturate));
          box-shadow: 0 24px 70px color-mix(in oklab, var(--breath-hue) 44%, transparent);
          transition:
            transform var(--phase-duration) var(--phase-ease),
            opacity var(--phase-duration) var(--phase-ease),
            filter 1400ms cubic-bezier(0.22, 0.76, 0.24, 1),
            background 1400ms cubic-bezier(0.22, 0.76, 0.24, 1);
        }
        .core-highlight {
          width: 58%;
          height: 58%;
          left: 20%;
          top: 16%;
          background: radial-gradient(circle, rgba(255, 246, 244, 0.52) 0%, rgba(255, 246, 244, 0.1) 56%, transparent 100%);
          filter: blur(10px);
        }
        .progress-ring {
          transform: rotate(-90deg);
        }
        .ring-track,
        .ring-progress {
          fill: none;
          stroke-width: 2.4;
        }
        .ring-track {
          stroke: color-mix(in oklab, var(--breath-hue) 20%, transparent);
          transition: stroke 1400ms cubic-bezier(0.22, 0.76, 0.24, 1), opacity 700ms ease;
          opacity: 0.26;
        }
        .ring-progress {
          stroke: color-mix(in oklab, var(--breath-hue) 52%, rgba(255, 246, 244, 0.32));
          stroke-linecap: round;
          stroke-dasharray: var(--ring-circumference);
          stroke-dashoffset: 0;
          opacity: 0.38;
          filter: drop-shadow(0 0 6px color-mix(in oklab, var(--breath-hue) 46%, transparent));
          transition:
            stroke 1400ms cubic-bezier(0.22, 0.76, 0.24, 1),
            filter 1400ms cubic-bezier(0.22, 0.76, 0.24, 1),
            opacity 700ms ease;
        }
        .ring-progress.is-hold {
          animation: breath-ring-hold 2.4s ease-in-out infinite;
        }
        [data-phase='inhale'] .breathing-core,
        [data-phase='inhale'] .aura-inner {
          animation: breath-inhale-grow var(--phase-duration) var(--phase-ease) both;
        }
        [data-phase='hold_in'] .breathing-core,
        [data-phase='hold_out'] .breathing-core,
        [data-phase='hold_in'] .aura-inner,
        [data-phase='hold_out'] .aura-inner {
          animation: breath-shimmer 3.5s ease-in-out infinite;
        }
        .phase-word {
          font-weight: 400;
          letter-spacing: 0;
          text-shadow: 0 0 10px color-mix(in oklab, var(--breath-hue) 20%, transparent);
          transform: translateY(calc((1 - var(--orb-scale)) * 8px)) scale(calc(0.94 + var(--orb-scale) * 0.08));
          transition:
            color 900ms ease,
            opacity 900ms ease,
            transform var(--phase-duration) var(--phase-ease);
          opacity: 0.9;
        }
        .countdown {
          letter-spacing: 0.04em;
          text-shadow: 0 0 10px color-mix(in oklab, var(--breath-hue) 18%, transparent);
          transform: translateY(calc((1 - var(--orb-scale)) * 10px));
          transition:
            opacity 900ms ease,
            transform var(--phase-duration) var(--phase-ease);
          opacity: 0.86;
        }
        @keyframes breath-ring-deplete {
          from {
            stroke-dashoffset: 0;
          }
          to {
            stroke-dashoffset: var(--ring-circumference);
          }
        }
        @keyframes breath-ring-hold {
          0%, 100% {
            opacity: 0.75;
          }
          50% {
            opacity: 1;
          }
        }
        @keyframes breath-shimmer {
          0%, 100% {
            opacity: 0.92;
            filter: saturate(var(--core-saturate)) brightness(1);
          }
          50% {
            opacity: 1;
            filter: saturate(var(--core-saturate)) brightness(1.06);
          }
        }
        @keyframes breath-inhale-grow {
          from {
            transform: scale(${SCALE_MIN});
          }
          to {
            transform: scale(${SCALE_MAX});
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .aura-outer,
          .aura-inner,
          .breathing-core {
            transition: opacity 420ms ease, background 420ms ease, transform 0s linear !important;
            animation: none !important;
            transform: scale(0.78) !important;
          }
          .ring-progress {
            animation-timing-function: linear !important;
          }
        }
      `}</style>
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
