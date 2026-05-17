import { useEffect, useId, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '../ui/utils';
import type { SlimeProfile } from '../../model';
import { DEFAULT_SLIME_PROFILE } from '../../../hooks/useSlimeProfile';
import { slimeThemePalette } from '../../../features/slime/slimeThemePalette';
import type { SlimeType } from '../../../features/slime/slimeIdentity';

export type SlimeAdvisorState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'remembering'
  | 'preparing'
  | 'speaking'
  | 'cautious'
  | 'celebrating';

export type SlimeAdvisorProps = {
  state?: SlimeAdvisorState;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  profile?: SlimeProfile;
  slimeType?: SlimeType;
  /** Stronger hover / float — for buddy home, not dense report rows. */
  companionMode?: boolean;
  /** Embedded in chat studio — centered, softer colors, less horizontal drift. */
  studioScene?: boolean;
};

const sizeMap = { sm: 56, md: 76, lg: 104 } as const;

/** Buddy-only expression cycle (2D — no 3D spin). */
const BUDDY_MOOD_CYCLE_MS = 4200;

export function SlimeAdvisor({
  state = 'idle',
  size = 'md',
  className,
  profile,
  slimeType = 'generalized',
  companionMode = false,
  studioScene = false,
}: SlimeAdvisorProps) {
  const p = profile ?? DEFAULT_SLIME_PROFILE;
  const t = slimeThemePalette(p, slimeType);
  const isWellbeing = slimeType === 'wellbeing';
  const uid = useId().replace(/:/g, '');
  const dim = sizeMap[size];
  const [buddyMood, setBuddyMood] = useState(0);

  useEffect(() => {
    if (!companionMode) return;
    const id = window.setInterval(() => setBuddyMood((m) => (m + 1) % 4), BUDDY_MOOD_CYCLE_MS);
    return () => window.clearInterval(id);
  }, [companionMode]);
  const gBody = `slime-body-${uid}`;
  const gBodyCore = `slime-body-core-${uid}`;
  const gGlass = `slime-glass-${uid}`;
  const gSpecular = `slime-spec-${uid}`;
  const isSpeaking = state === 'speaking';
  const isListening = state === 'listening';
  const isRemembering = state === 'remembering';
  const isPreparing = state === 'preparing';
  const isThinking = state === 'thinking' || isRemembering || isPreparing;
  const isCautious = state === 'cautious';
  const isCelebrating = state === 'celebrating';
  const hoverBright = state === 'idle' || state === 'celebrating' || isListening;
  const motionScale = p.motion === 'subtle' ? 0.78 : p.motion === 'expressive' ? 1.3 : 1;
  const personalityFloat =
    p.personality === 'playful' ? 1.1 : p.personality === 'direct' ? 0.78 : p.personality === 'calm' ? 0.88 : 1;
  const personalityBody = p.personality === 'direct' ? 0.9 : p.personality === 'calm' ? 1.06 : 1;
  const bodySpeed = ((isSpeaking ? 0.45 : isThinking || isListening ? 0.65 : 1.1) / motionScale) * personalityBody;
  const floatAmp = (isSpeaking ? 2.2 : 1.2) * motionScale * personalityFloat;
  let blinkDuration = p.motion === 'subtle' ? 6.2 : p.motion === 'expressive' ? 3.8 : 5;
  if (p.personality === 'calm') blinkDuration += 0.9;
  if (p.personality === 'cautious') blinkDuration += 0.55;
  if (p.personality === 'playful') blinkDuration -= 0.45;
  const mouthSpeed = p.motion === 'expressive' ? 0.3 : 0.38;
  const spread = studioScene ? dim * 2.05 : dim * 2.45;
  const bodyOpacity = isWellbeing ? 0.98 : 0.8;
  const coreOpacity = isWellbeing ? 0.94 : 0.66;
  const shouldShowProfileGlasses = p.accessory === 'glasses' && !isWellbeing && slimeType !== 'generalized';
  const leftEyeX = 39.5;
  const rightEyeX = 60.5;
  const eyeStroke = isWellbeing ? 'rgba(180,104,121,0.72)' : 'rgba(59,130,246,0.76)';

  const shape =
    p.shape === 'orb'
      ? { rx: 34, ry: 34, eyeY: 39, mouthY: 60 }
      : p.shape === 'robot'
        ? { rx: 35, ry: 30, eyeY: 40, mouthY: 61 }
        : p.shape === 'crystal'
          ? { rx: 33, ry: 31, eyeY: 39, mouthY: 60 }
          : p.shape === 'ghost'
            ? { rx: 35, ry: 33, eyeY: 41, mouthY: 63 }
            : { rx: 36, ry: 32, eyeY: 40, mouthY: 62 };

  return (
    <div className={cn('relative flex items-center justify-center overflow-visible', className)} style={{ width: spread, height: spread }} data-slime-state={state} data-testid="slime-advisor">
      {!companionMode ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{ width: dim * 0.48, height: dim * 0.48, left: '50%', top: '50%', marginLeft: -(dim * 0.24), marginTop: -(dim * 0.24), border: `1px solid ${t.ring}`, boxShadow: `0 0 14px ${t.ring}` }}
              initial={false}
              animate={{ scale: [0.88, 2.45], opacity: [0.26, 0] }}
              transition={{ duration: 2.75, repeat: Infinity, ease: [0.2, 0.8, 0.2, 1], delay: i * 0.72 }}
            />
          ))}
        </div>
      ) : null}

      {companionMode && isListening ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={`listen-${i}`}
              className="absolute rounded-full border-2"
              style={{
                width: dim * 0.55,
                height: dim * 0.55,
                left: '50%',
                top: '50%',
                marginLeft: -(dim * 0.275),
                marginTop: -(dim * 0.275),
                borderColor: isWellbeing ? 'rgba(232,160,176,0.65)' : 'rgba(96,165,250,0.55)',
                boxShadow: isWellbeing ? '0 0 18px rgba(232,160,176,0.35)' : '0 0 18px rgba(96,165,250,0.35)',
              }}
              initial={false}
              animate={{ scale: [0.95, 2.1], opacity: [0.45, 0] }}
              transition={{ duration: 1.45, repeat: Infinity, ease: [0.2, 0.8, 0.2, 1], delay: i * 0.38 }}
            />
          ))}
        </div>
      ) : null}

      {companionMode && isRemembering ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={`mem-${i}`}
              className="absolute h-2 w-2 rounded-full"
              style={{
                left: '50%',
                top: '50%',
                marginLeft: -4,
                marginTop: -4,
                backgroundColor: isWellbeing ? 'rgba(240,184,196,0.9)' : 'rgba(147,197,253,0.9)',
                boxShadow: isWellbeing ? '0 0 14px rgba(232,160,176,0.45)' : '0 0 14px rgba(96,165,250,0.45)',
              }}
              animate={{
                x: [0, Math.cos((i / 3) * Math.PI * 2) * dim * 0.62, 0],
                y: [0, Math.sin((i / 3) * Math.PI * 2) * dim * 0.44, 0],
                opacity: [0.15, 0.9, 0.15],
              }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: i * 0.18 }}
            />
          ))}
        </div>
      ) : null}

      {companionMode && isPreparing ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <motion.div
            className="absolute rounded-full border border-fuchsia-300/60"
            style={{
              width: dim * 0.92,
              height: dim * 0.92,
              boxShadow: '0 0 24px rgba(217,70,239,0.24)',
            }}
            animate={{ scale: [0.95, 1.18, 0.95], opacity: [0.28, 0.72, 0.28] }}
            transition={{ duration: 1.05, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
      ) : null}

      <motion.div
        aria-hidden
        className={cn(
          'pointer-events-none absolute rounded-full blur-md',
          isCautious || p.personality === 'cautious' ? 'bg-amber-400/35' : undefined,
        )}
        style={{
          width: dim * 1.35,
          height: dim * 1.35,
          background: `radial-gradient(circle, color-mix(in srgb, ${t.b} 42%, transparent) 0%, transparent 72%)`,
        }}
        animate={
          isListening
            ? { opacity: [0.5, 0.95, 0.5], scale: [1, 1.08, 1] }
            : isThinking || isCautious
              ? { opacity: [0.45, 0.85, 0.45], scale: [1, 1.06, 1] }
              : isCelebrating
                ? { opacity: [0.5, 0.9, 0.5], scale: [1, 1.04, 1] }
                : { opacity: 0.55, scale: 1 }
        }
        transition={{ duration: isListening ? 1.25 : isThinking ? 2.2 : 2.8, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        className="relative z-[2]"
        style={{ width: dim, height: dim }}
        whileHover={companionMode ? undefined : { scale: 1.04, rotate: -2 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
      >
        <div className="h-full w-full" style={companionMode ? undefined : { perspective: 260 }}>
          <motion.div
            className="h-full w-full overflow-visible"
            style={companionMode ? undefined : { transformStyle: 'preserve-3d' }}
            animate={
              companionMode
                ? isListening
                  ? {
                      y: [0, -5, 0, -4, 0],
                      x: studioScene ? [0, 1, -1, 0] : [0, 2, -2, 0],
                      rotateZ: [0, -2, 2, 0],
                      scale: [1, 1.04, 1, 1.02, 1],
                    }
                  : studioScene
                    ? {
                        y: [0, -10, 0, -14, 0],
                        x: [0, 2, -2, 0],
                        rotateZ: [0, -2.5, 2.5, 0],
                        scale: [1, 1.02, 0.99, 1.01, 1],
                      }
                    : {
                        y: [0, -16, 0, -28, 0, -12, 0, -22, 0],
                        x: [0, 7, -7, 0, -6, 6, 0],
                        rotateZ: [0, -5, 5, -3.5, 3.5, 0],
                        scale: [1, 1.03, 0.99, 1.02, 1],
                      }
                : {
                    y: [0, -floatAmp, 0],
                    rotateX: [9, 11.2, 9],
                    rotateY: [-5.5, -4, -6],
                  }
            }
            transition={{
              duration: companionMode ? (isListening ? 1.6 : 4.2) : isSpeaking ? 1.8 : 3.2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            <svg
              width={dim}
              height={dim}
              viewBox="0 0 100 100"
              className={cn(
                'block overflow-visible',
                isWellbeing
                  ? 'drop-shadow-[0_6px_14px_rgba(232,160,176,0.22)] drop-shadow-[0_16px_28px_rgba(240,184,196,0.28)]'
                  : 'drop-shadow-[0_6px_14px_rgba(37,99,235,0.12)] drop-shadow-[0_16px_28px_rgba(96,165,250,0.22)]',
              )}
              style={companionMode ? undefined : { transform: 'translateZ(12px)' }}
            >
          <defs>
            {/* Volume: radial + core tint for a soft "blob in space" read */}
            <radialGradient id={gBody} cx="38%" cy="28%" r="78%" fx="34%" fy="22%">
              <stop offset="0%" stopColor={t.c} stopOpacity="0.95" />
              <stop offset="28%" stopColor={t.b} stopOpacity="1" />
              <stop offset="58%" stopColor={t.a} stopOpacity="1" />
              <stop offset="100%" stopColor={t.deep} stopOpacity="1" />
            </radialGradient>
            <radialGradient id={gBodyCore} cx="50%" cy="62%" r="58%">
              <stop offset="0%" stopColor={t.b} stopOpacity={isWellbeing ? '0.35' : '0.15'} />
              <stop offset="55%" stopColor={t.c} stopOpacity={isWellbeing ? '0.5' : '0.55'} />
              <stop offset="100%" stopColor={t.a} stopOpacity={isWellbeing ? '0.22' : '0.35'} />
            </radialGradient>
            <radialGradient id={gSpecular} cx="36%" cy="26%" r="48%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.88" />
              <stop offset="28%" stopColor="#ffffff" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`rim-${uid}`} cx="72%" cy="68%" r="42%">
              <stop offset="0%" stopColor={t.b} stopOpacity={isWellbeing ? '0.32' : '0.38'} />
              <stop offset="72%" stopColor={t.c} stopOpacity={isWellbeing ? '0.16' : '0.2'} />
              <stop offset="100%" stopColor={t.a} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={gGlass} x1="22%" y1="0%" x2="55%" y2="85%">
              <stop offset="0%" stopColor="white" stopOpacity="0.62" />
              <stop offset="45%" stopColor="white" stopOpacity="0.18" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>
            <filter id={`glow-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id={`ground-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.2" />
            </filter>
            <filter id={`premium-${uid}`} x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="2.8" result="blur" />
              <feOffset in="blur" dx="0" dy="2" result="offsetBlur" />
              <feComponentTransfer in="offsetBlur" result="shadow">
                <feFuncA type="linear" slope="0.28" />
              </feComponentTransfer>
              <feMerge>
                <feMergeNode in="shadow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <motion.g
            animate={
              companionMode
                ? { rotate: [0, 3.2, -3.2, 0], scaleX: [1, 1.08, 0.92, 1.06, 1], scaleY: [1, 0.93, 1.08, 0.95, 1] }
                : { rotate: [0, 1.2, -0.8, 0], scaleX: [1, 1.04, 0.98, 1], scaleY: [1, 0.97, 1.03, 1] }
            }
            transition={{ duration: companionMode ? 2 : bodySpeed * 4.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ellipse
              cx={50}
              cy={71}
              rx={shape.rx * 0.78}
              ry={shape.ry * 0.2}
              fill={isWellbeing ? 'rgba(232, 160, 176, 0.14)' : 'rgba(59, 130, 246, 0.12)'}
              filter={`url(#ground-${uid})`}
              opacity={0.85}
            />
            <motion.g
              filter={`url(#premium-${uid})`}
              animate={isSpeaking ? { y: [0, 0.45, 0] } : { y: 0 }}
              transition={{ duration: bodySpeed * 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <motion.ellipse
                cx={50}
                cy={54}
                rx={shape.rx}
                ry={shape.ry}
                initial={{ rx: shape.rx, ry: shape.ry }}
                fill={`url(#${gBody})`}
                fillOpacity={bodyOpacity}
                stroke="rgba(255,255,255,0.34)"
                strokeWidth={0.9}
                animate={
                  isSpeaking
                    ? { rx: [shape.rx - 2, shape.rx + 2, shape.rx - 1], ry: [shape.ry - 2, shape.ry + 2, shape.ry - 1] }
                    : companionMode
                      ? { rx: [shape.rx, shape.rx - 1.2, shape.rx + 1, shape.rx], ry: [shape.ry, shape.ry + 1.1, shape.ry - 0.9, shape.ry] }
                      : { rx: [shape.rx, shape.rx - 1, shape.rx + 1, shape.rx], ry: [shape.ry, shape.ry + 1, shape.ry - 1, shape.ry] }
                }
                transition={{
                  duration: isSpeaking ? bodySpeed * 3.5 : companionMode ? 1.6 : bodySpeed * 3.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
              <ellipse
                cx={50}
                cy={54}
                rx={shape.rx * 0.96}
                ry={shape.ry * 0.95}
                fill={`url(#${gBodyCore})`}
                opacity={coreOpacity}
                style={{ mixBlendMode: isWellbeing ? 'soft-light' : 'multiply' }}
                pointerEvents="none"
              />
              <ellipse
                cx={50}
                cy={54}
                rx={shape.rx * 0.88}
                ry={shape.ry * 0.84}
                fill="rgba(255,255,255,0.12)"
                style={{ mixBlendMode: 'screen' }}
                pointerEvents="none"
              />
              {isWellbeing ? (
                <motion.g
                  pointerEvents="none"
                  animate={{
                    rotate: [-1.8, 2.2, -1.2],
                    x: [-0.8, 0.9, -0.4],
                    y: [0.4, -0.7, 0.4],
                  }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ transformOrigin: '50px 25px' }}
                >
                  <ellipse
                    cx={50}
                    cy={24}
                    rx={16}
                    ry={5.1}
                    fill="none"
                    stroke="rgba(255, 218, 112, 0.72)"
                    strokeWidth={1.55}
                  />
                  <ellipse
                    cx={50}
                    cy={24}
                    rx={12.5}
                    ry={3.4}
                    fill="rgba(255, 246, 197, 0.16)"
                  />
                </motion.g>
              ) : null}
              <ellipse
                cx={44}
                cy={42}
                rx={shape.rx * 0.56}
                ry={shape.ry * 0.42}
                fill={`url(#${gSpecular})`}
                style={{ mixBlendMode: 'soft-light' }}
                pointerEvents="none"
              />
              <path
                d="M25 50 C30 29, 48 18, 66 27"
                fill="none"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth={3.8}
                strokeLinecap="round"
                opacity={isWellbeing ? 0.55 : 0.42}
                pointerEvents="none"
              />
              <ellipse
                cx={62}
                cy={58}
                rx={shape.rx * 0.42}
                ry={shape.ry * 0.32}
                fill={`url(#rim-${uid})`}
                style={{ mixBlendMode: 'soft-light' }}
                pointerEvents="none"
              />
            </motion.g>
            <ellipse cx={47} cy={36} rx={22} ry={13.5} fill={`url(#${gGlass})`} style={{ mixBlendMode: 'overlay' }} />
            {p.shape === 'robot' ? <rect x={29} y={27} width={42} height={14} rx={5} fill="rgba(255,255,255,0.22)" /> : null}
            {p.shape === 'crystal' ? <polygon points="50,18 60,30 50,38 40,30" fill="rgba(255,255,255,0.28)" /> : null}
          </motion.g>

          <g filter={`url(#glow-${uid})`}>
            <motion.g animate={isSpeaking || isCelebrating ? { scale: 1.06 } : hoverBright ? { scale: [1, 1.04, 1] } : { scale: 1 }} transition={{ duration: 2.2, repeat: isSpeaking || isCelebrating || hoverBright ? Infinity : 0, ease: 'easeInOut' }} style={{ transformOrigin: '50px 40px' }}>
              <motion.g
                key={companionMode ? `buddy-eye-${buddyMood}` : 'eye-blink'}
                animate={{ scaleY: [1, 1, 1, 0.15, 1, 1] }}
                transition={{ duration: blinkDuration, repeat: Infinity, ease: 'easeInOut', times: [0, 0.86, 0.87, 0.89, 0.91, 1] }}
                style={{ transformOrigin: '50px 40px' }}
              >
                {companionMode && !isSpeaking && buddyMood === 3 ? (
                  <>
                    <ellipse cx={leftEyeX} cy={shape.eyeY} rx={4.65} ry={1.35} className="fill-white" stroke={eyeStroke} strokeWidth={0.65} />
                    <ellipse cx={rightEyeX} cy={shape.eyeY} rx={4.65} ry={1.35} className="fill-white" stroke={eyeStroke} strokeWidth={0.65} />
                  </>
                ) : (
                  <>
                    <circle
                      cx={leftEyeX}
                      cy={shape.eyeY + (companionMode && !isSpeaking && buddyMood === 1 ? -0.6 : 0)}
                      r={companionMode && !isSpeaking ? (buddyMood === 2 ? 5.25 : buddyMood === 1 ? 3.55 : 4.05) : 4.05}
                      className={cn('fill-white', isCautious ? 'opacity-95' : 'opacity-100')}
                      stroke={eyeStroke}
                      strokeWidth={0.65}
                    />
                    <circle
                      cx={rightEyeX}
                      cy={shape.eyeY + (companionMode && !isSpeaking && buddyMood === 1 ? -0.6 : 0)}
                      r={companionMode && !isSpeaking ? (buddyMood === 2 ? 5.25 : buddyMood === 1 ? 3.55 : 4.05) : 4.05}
                      className="fill-white"
                      stroke={eyeStroke}
                      strokeWidth={0.65}
                    />
                  </>
                )}
              </motion.g>
              {shouldShowProfileGlasses ? (
                <g stroke={isWellbeing ? 'rgba(201,123,139,0.55)' : 'rgba(59,130,246,0.5)'} fill="none" strokeWidth={1.2}>
                  <circle cx={leftEyeX} cy={shape.eyeY} r={5.6} />
                  <circle cx={rightEyeX} cy={shape.eyeY} r={5.6} />
                  <path d={`M46.5 ${shape.eyeY} L53.5 ${shape.eyeY}`} />
                </g>
              ) : null}
              {p.accessory === 'antenna' ? (
                <g stroke="rgba(248,250,252,0.82)" strokeWidth={1.2}>
                  <path d="M50 22 L50 13" />
                  <circle cx={50} cy={11} r={1.8} fill="rgba(56,189,248,0.95)" />
                </g>
              ) : null}
              {p.accessory === 'halo' && !isWellbeing ? (
                <ellipse cx={50} cy={20} rx={13} ry={4} fill="none" stroke="rgba(250,204,21,0.7)" strokeWidth={1.2} />
              ) : null}
              {p.accessory === 'scarf' ? <path d="M35 66 Q50 72 65 66" fill="none" stroke="rgba(244,114,182,0.82)" strokeWidth={2.2} /> : null}
            </motion.g>
          </g>

          <motion.ellipse
            cx={50}
            cy={shape.mouthY + (companionMode && !isSpeaking && buddyMood === 1 ? -1.2 : 0)}
            rx={6.3}
            ry={1.55}
            fill={isWellbeing ? 'rgba(145, 71, 86, 0.58)' : 'rgba(30, 64, 175, 0.48)'}
            initial={{ rx: 6.3, ry: 1.55 }}
            animate={
              isSpeaking
                ? { ry: [2.2, 4.8, 2.7, 4.3, 2.1], opacity: 0.92, rx: 6.4 }
                : companionMode
                  ? buddyMood === 0
                    ? { rx: 6.3, ry: 1.55, opacity: 0.58 }
                    : buddyMood === 1
                      ? { rx: 8.8, ry: 3, opacity: 0.66 }
                      : buddyMood === 2
                        ? { rx: 4.7, ry: 5, opacity: 0.7 }
                        : { rx: 7, ry: 1.25, opacity: 0.48 }
                  : { ry: 1.55, opacity: 0.56, rx: 6.3 }
            }
            transition={
              isSpeaking ? { duration: mouthSpeed, repeat: Infinity, ease: 'easeInOut' } : companionMode ? { duration: 0.4, ease: 'easeOut' } : { duration: 0.25 }
            }
            data-testid="slime-mouth"
          />
          {isWellbeing && !isSpeaking ? (
            <motion.path
              d={`M43 ${shape.mouthY - 0.6} Q50 ${shape.mouthY + 4.8} 57 ${shape.mouthY - 0.6}`}
              fill="none"
              stroke="rgba(145, 71, 86, 0.58)"
              strokeWidth={2}
              strokeLinecap="round"
              animate={companionMode ? { opacity: [0.68, 0.92, 0.68] } : { opacity: 0.82 }}
              transition={{ duration: 2.4, repeat: companionMode ? Infinity : 0, ease: 'easeInOut' }}
            />
          ) : null}
          {p.shape === 'ghost' ? <path d="M28 74 C34 70, 40 78, 46 74 C52 70, 58 78, 64 74 C68 72, 70 74, 72 76" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={1.4} /> : null}
            </svg>
          </motion.div>
        </div>

        {isThinking || p.personality === 'analytical' ? (
          <motion.div aria-hidden className="pointer-events-none absolute inset-0 flex justify-center" animate={{ rotate: 360 }} transition={{ duration: 2.9, repeat: Infinity, ease: 'linear' }}>
            <span className="mt-0.5 h-2 w-2 rounded-full bg-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.85)]" />
          </motion.div>
        ) : null}

        {isCelebrating ? <motion.span aria-hidden className="pointer-events-none absolute -right-0.5 top-1 h-1.5 w-1.5 rounded-full bg-violet-200/90" animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.15, 0.9] }} transition={{ duration: 1.6, repeat: Infinity }} /> : null}

        {p.accessory === 'spark' ? (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {[
              { x: -dim * 0.42, y: -dim * 0.12, d: 0 },
              { x: dim * 0.38, y: -dim * 0.22, d: 0.35 },
              { x: dim * 0.08, y: -dim * 0.48, d: 0.7 },
              { x: -dim * 0.28, y: dim * 0.32, d: 0.2 },
            ].map((pt, i) => {
              const s = dim * 0.08;
              return (
                <motion.span
                  key={i}
                  className="absolute rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.95)]"
                  style={{
                    width: s,
                    height: s,
                    left: `calc(50% + ${pt.x}px)`,
                    top: `calc(50% + ${pt.y}px)`,
                    marginLeft: -s / 2,
                    marginTop: -s / 2,
                  }}
                  animate={{ opacity: [0.15, 0.95, 0.15], scale: [0.65, 1.15, 0.65] }}
                  transition={{ duration: 1.55 + i * 0.12, repeat: Infinity, ease: 'easeInOut', delay: pt.d }}
                />
              );
            })}
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
