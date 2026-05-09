import { useId } from 'react';
import { motion } from 'motion/react';
import { cn } from '../ui/utils';

export type SlimeAdvisorState = 'idle' | 'thinking' | 'speaking' | 'cautious' | 'celebrating';

export type SlimeAdvisorProps = {
  state?: SlimeAdvisorState;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const sizeMap = { sm: 56, md: 76, lg: 104 } as const;

/**
 * Original premium slime look (gradient glass blob, eyes, mouth when speaking)
 * + soft concentric rings that expand outward (“光圈外散”).
 */
export function SlimeAdvisor({ state = 'idle', size = 'md', className }: SlimeAdvisorProps) {
  const uid = useId().replace(/:/g, '');
  const dim = sizeMap[size];
  const gBody = `slime-body-${uid}`;
  const gGlass = `slime-glass-${uid}`;
  const isSpeaking = state === 'speaking';
  const isThinking = state === 'thinking';
  const isCautious = state === 'cautious';
  const isCelebrating = state === 'celebrating';
  const hoverBright = state === 'idle' || state === 'celebrating';

  const bodySpeed = isSpeaking ? 0.45 : isThinking ? 0.65 : 1.1;
  const floatAmp = isSpeaking ? 2.2 : 1.2;
  const spread = dim * 2.45;

  return (
    <div
      className={cn('relative flex items-center justify-center overflow-visible', className)}
      style={{ width: spread, height: spread }}
      data-slime-state={state}
      data-testid="slime-advisor"
    >
      {/* Outward-spreading light rings */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full border border-violet-400/35 dark:border-violet-400/25"
            style={{
              width: dim * 0.48,
              height: dim * 0.48,
              left: '50%',
              top: '50%',
              marginLeft: -(dim * 0.24),
              marginTop: -(dim * 0.24),
              boxShadow: '0 0 14px rgba(129, 140, 248, 0.14)',
            }}
            initial={false}
            animate={{
              scale: [0.88, 2.45],
              opacity: [0.26, 0],
            }}
            transition={{
              duration: 2.75,
              repeat: Infinity,
              ease: [0.2, 0.8, 0.2, 1],
              delay: i * 0.72,
            }}
          />
        ))}
      </div>

      {/* Advisor aura */}
      <motion.div
        aria-hidden
        className={cn(
          'pointer-events-none absolute rounded-full blur-md',
          isCautious ? 'bg-amber-400/35' : 'bg-violet-400/30',
        )}
        style={{ width: dim * 1.35, height: dim * 1.35 }}
        animate={
          isThinking || isCautious
            ? { opacity: [0.45, 0.85, 0.45], scale: [1, 1.06, 1] }
            : isCelebrating
              ? { opacity: [0.5, 0.9, 0.5], scale: [1, 1.04, 1] }
              : { opacity: 0.55, scale: 1 }
        }
        transition={{ duration: isThinking ? 2.2 : 2.8, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        className="relative z-[2]"
        style={{ width: dim, height: dim }}
        whileHover={{ scale: 1.04, rotate: -2 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
      >
        <motion.svg
          width={dim}
          height={dim}
          viewBox="0 0 100 100"
          className="overflow-visible drop-shadow-[0_10px_22px_rgba(79,70,229,0.22)]"
          animate={{ y: [0, -floatAmp, 0] }}
          transition={{ duration: isSpeaking ? 1.8 : 3.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <defs>
            <linearGradient id={gBody} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="45%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>
            <linearGradient id={gGlass} x1="20%" y1="0%" x2="60%" y2="80%">
              <stop offset="0%" stopColor="white" stopOpacity="0.55" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>
            <filter id={`glow-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <motion.g
            animate={{
              rotate: [0, 1.2, -0.8, 0],
              scaleX: [1, 1.04, 0.98, 1],
              scaleY: [1, 0.97, 1.03, 1],
            }}
            transition={{ duration: bodySpeed * 4.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <motion.ellipse
              cx={50}
              cy={54}
              rx={36}
              ry={32}
              fill={`url(#${gBody})`}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={1.2}
              animate={
                isSpeaking
                  ? { rx: [34, 38, 35], ry: [30, 33, 31] }
                  : { rx: [36, 35, 37, 36], ry: [32, 33, 31, 32] }
              }
              transition={{ duration: bodySpeed * 3.5, repeat: Infinity, ease: 'easeInOut' }}
            />
            <ellipse cx={48} cy={38} rx={22} ry={14} fill={`url(#${gGlass})`} />
          </motion.g>

          <g filter={`url(#glow-${uid})`}>
            <motion.g
              animate={
                isSpeaking || isCelebrating
                  ? { scale: 1.06 }
                  : hoverBright
                    ? { scale: [1, 1.04, 1] }
                    : { scale: 1 }
              }
              transition={{ duration: 2.2, repeat: isSpeaking || isCelebrating || hoverBright ? Infinity : 0, ease: 'easeInOut' }}
              style={{ transformOrigin: '50px 40px' }}
            >
              <motion.g
                animate={{ scaleY: [1, 1, 1, 0.15, 1, 1] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', times: [0, 0.86, 0.87, 0.89, 0.91, 1] }}
                style={{ transformOrigin: '50px 40px' }}
              >
                <circle
                  cx={38}
                  cy={40}
                  r={3.2}
                  className={cn('fill-white', isCautious ? 'opacity-95' : 'opacity-100')}
                  stroke="rgba(129,140,248,0.9)"
                  strokeWidth={0.6}
                />
                <circle cx={62} cy={40} r={3.2} className="fill-white" stroke="rgba(129,140,248,0.9)" strokeWidth={0.6} />
              </motion.g>
            </motion.g>
          </g>

          <motion.ellipse
            cx={50}
            cy={62}
            rx={5.5}
            fill="rgba(30,27,75,0.35)"
            initial={false}
            animate={
              isSpeaking
                ? { ry: [1.8, 4.2, 2.4, 3.8, 2], opacity: 0.85 }
                : { ry: 1.2, opacity: 0.35 }
            }
            transition={
              isSpeaking ? { duration: 0.38, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.25 }
            }
            data-testid="slime-mouth"
          />
        </motion.svg>

        {isThinking ? (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex justify-center"
            animate={{ rotate: 360 }}
            transition={{ duration: 2.9, repeat: Infinity, ease: 'linear' }}
          >
            <span className="mt-0.5 h-2 w-2 rounded-full bg-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.85)]" />
          </motion.div>
        ) : null}

        {isCelebrating ? (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute -right-0.5 top-1 h-1.5 w-1.5 rounded-full bg-violet-200/90"
            animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.15, 0.9] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
        ) : null}
      </motion.div>
    </div>
  );
}
