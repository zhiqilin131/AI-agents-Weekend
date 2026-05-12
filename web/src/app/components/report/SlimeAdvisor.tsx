import { useEffect, useId, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '../ui/utils';
import type { SlimeProfile } from '../../model';
import { DEFAULT_SLIME_PROFILE } from '../../../hooks/useSlimeProfile';
import { slimeThemePalette } from '../../../features/slime/slimeThemePalette';

export type SlimeAdvisorState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'cautious' | 'celebrating';

export type SlimeAdvisorProps = {
  state?: SlimeAdvisorState;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  profile?: SlimeProfile;
  /** Stronger hover / float — for buddy home, not dense report rows. */
  companionMode?: boolean;
};

const sizeMap = { sm: 56, md: 76, lg: 104 } as const;

/** Buddy-only expression cycle (2D — no 3D spin). */
const BUDDY_MOOD_CYCLE_MS = 4200;

export function SlimeAdvisor({ state = 'idle', size = 'md', className, profile, companionMode = false }: SlimeAdvisorProps) {
  const p = profile ?? DEFAULT_SLIME_PROFILE;
  const t = slimeThemePalette(p);
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
  const isThinking = state === 'thinking';
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
  const spread = dim * 2.45;

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
              className="absolute rounded-full border-2 border-cyan-400/55"
              style={{
                width: dim * 0.55,
                height: dim * 0.55,
                left: '50%',
                top: '50%',
                marginLeft: -(dim * 0.275),
                marginTop: -(dim * 0.275),
                boxShadow: '0 0 18px rgba(34,211,238,0.35)',
              }}
              initial={false}
              animate={{ scale: [0.95, 2.1], opacity: [0.45, 0] }}
              transition={{ duration: 1.45, repeat: Infinity, ease: [0.2, 0.8, 0.2, 1], delay: i * 0.38 }}
            />
          ))}
        </div>
      ) : null}

      <motion.div
        aria-hidden
        className={cn('pointer-events-none absolute rounded-full blur-md', isCautious || p.personality === 'cautious' ? 'bg-amber-400/35' : 'bg-violet-400/30')}
        style={{ width: dim * 1.35, height: dim * 1.35 }}
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
                  ? { y: [0, -5, 0, -4, 0], x: [0, 2, -2, 0], rotateZ: [0, -2, 2, 0], scale: [1, 1.04, 1, 1.02, 1] }
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
              className="block overflow-visible drop-shadow-[0_6px_14px_rgba(15,23,42,0.14)] drop-shadow-[0_18px_32px_rgba(79,70,229,0.18)]"
              style={companionMode ? undefined : { transform: 'translateZ(12px)' }}
            >
          <defs>
            {/* Volume: radial + core tint for a soft "blob in space" read */}
            <radialGradient id={gBody} cx="38%" cy="32%" r="72%" fx="32%" fy="26%">
              <stop offset="0%" stopColor={t.b} stopOpacity="1" />
              <stop offset="42%" stopColor={t.a} />
              <stop offset="100%" stopColor={t.c} stopOpacity="1" />
            </radialGradient>
            <radialGradient id={gBodyCore} cx="50%" cy="62%" r="58%">
              <stop offset="0%" stopColor={t.a} stopOpacity="0.15" />
              <stop offset="55%" stopColor={t.c} stopOpacity="0.55" />
              <stop offset="100%" stopColor="#0f172a" stopOpacity="0.35" />
            </radialGradient>
            <radialGradient id={gSpecular} cx="40%" cy="30%" r="45%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.72" />
              <stop offset="35%" stopColor="#ffffff" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
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
              fill="rgba(15,23,42,0.2)"
              filter={`url(#ground-${uid})`}
              opacity={0.85}
            />
            <motion.g
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
                stroke="rgba(255,255,255,0.42)"
                strokeWidth={1.35}
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
                rx={shape.rx * 0.98}
                ry={shape.ry * 0.98}
                fill={`url(#${gBodyCore})`}
                style={{ mixBlendMode: 'multiply' }}
                pointerEvents="none"
              />
              <ellipse
                cx={44}
                cy={42}
                rx={shape.rx * 0.52}
                ry={shape.ry * 0.38}
                fill={`url(#${gSpecular})`}
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
                    <ellipse cx={38} cy={shape.eyeY} rx={3.7} ry={1.05} className="fill-white" stroke="rgba(129,140,248,0.9)" strokeWidth={0.6} />
                    <ellipse cx={62} cy={shape.eyeY} rx={3.7} ry={1.05} className="fill-white" stroke="rgba(129,140,248,0.9)" strokeWidth={0.6} />
                  </>
                ) : (
                  <>
                    <circle
                      cx={38}
                      cy={shape.eyeY + (companionMode && !isSpeaking && buddyMood === 1 ? -0.6 : 0)}
                      r={companionMode && !isSpeaking ? (buddyMood === 2 ? 4.4 : buddyMood === 1 ? 2.75 : 3.2) : 3.2}
                      className={cn('fill-white', isCautious ? 'opacity-95' : 'opacity-100')}
                      stroke="rgba(129,140,248,0.9)"
                      strokeWidth={0.6}
                    />
                    <circle
                      cx={62}
                      cy={shape.eyeY + (companionMode && !isSpeaking && buddyMood === 1 ? -0.6 : 0)}
                      r={companionMode && !isSpeaking ? (buddyMood === 2 ? 4.4 : buddyMood === 1 ? 2.75 : 3.2) : 3.2}
                      className="fill-white"
                      stroke="rgba(129,140,248,0.9)"
                      strokeWidth={0.6}
                    />
                  </>
                )}
              </motion.g>
              {p.accessory === 'glasses' ? (
                <g stroke="rgba(30,41,59,0.65)" fill="none" strokeWidth={1.2}>
                  <circle cx={38} cy={shape.eyeY} r={5.3} />
                  <circle cx={62} cy={shape.eyeY} r={5.3} />
                  <path d="M43 40 L57 40" />
                </g>
              ) : null}
              {p.accessory === 'antenna' ? (
                <g stroke="rgba(248,250,252,0.82)" strokeWidth={1.2}>
                  <path d="M50 22 L50 13" />
                  <circle cx={50} cy={11} r={1.8} fill="rgba(56,189,248,0.95)" />
                </g>
              ) : null}
              {p.accessory === 'halo' ? <ellipse cx={50} cy={20} rx={13} ry={4} fill="none" stroke="rgba(250,204,21,0.7)" strokeWidth={1.2} /> : null}
              {p.accessory === 'scarf' ? <path d="M35 66 Q50 72 65 66" fill="none" stroke="rgba(244,114,182,0.82)" strokeWidth={2.2} /> : null}
            </motion.g>
          </g>

          <motion.ellipse
            cx={50}
            cy={shape.mouthY + (companionMode && !isSpeaking && buddyMood === 1 ? -1.2 : 0)}
            rx={5.5}
            ry={1.2}
            fill="rgba(30,27,75,0.35)"
            initial={{ rx: 5.5, ry: 1.2 }}
            animate={
              isSpeaking
                ? { ry: [1.8, 4.2, 2.4, 3.8, 2], opacity: 0.85, rx: 5.5 }
                : companionMode
                  ? buddyMood === 0
                    ? { rx: 5.5, ry: 1.25, opacity: 0.38 }
                    : buddyMood === 1
                      ? { rx: 8.2, ry: 2.7, opacity: 0.48 }
                      : buddyMood === 2
                        ? { rx: 4.2, ry: 4.6, opacity: 0.52 }
                        : { rx: 6.5, ry: 1, opacity: 0.3 }
                  : { ry: 1.2, opacity: 0.35, rx: 5.5 }
            }
            transition={
              isSpeaking ? { duration: mouthSpeed, repeat: Infinity, ease: 'easeInOut' } : companionMode ? { duration: 0.4, ease: 'easeOut' } : { duration: 0.25 }
            }
            data-testid="slime-mouth"
          />
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
