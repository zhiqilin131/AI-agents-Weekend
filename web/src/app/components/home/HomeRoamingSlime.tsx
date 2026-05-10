import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { SlimeAdvisor } from '../report/SlimeAdvisor';
import { cn } from '../ui/utils';
import { DEFAULT_SLIME_PROFILE, useSlimeProfile } from '../../../hooks/useSlimeProfile';

const X_MIN = 8;
const X_MAX = 88;
const Y_MIN = 25;
const Y_MAX = 82;
/** Rough box around landing title + Start Chatting — wander targets avoid this. */
const HOME_AVOID = { x0: 28, x1: 72, y0: 30, y1: 68 };
/** Centered sign-in / sign-up card — keep slime in margins. */
const AUTH_AVOID = { x0: 26, x1: 74, y0: 22, y1: 78 };

export type HomeRoamingSlimeVariant = 'home' | 'auth';

function pickWanderTarget(mobile: boolean, variant: HomeRoamingSlimeVariant): { x: number; y: number } {
  const A = variant === 'auth' ? AUTH_AVOID : HOME_AVOID;
  for (let i = 0; i < 48; i += 1) {
    let x = X_MIN + Math.random() * (X_MAX - X_MIN);
    let y = Y_MIN + Math.random() * (Y_MAX - Y_MIN);
    if (mobile) {
      if (variant === 'auth') {
        // Corners & edges — clear the centered form
        const corner = Math.random();
        if (corner < 0.25) {
          x = 6 + Math.random() * 22;
          y = 10 + Math.random() * 35;
        } else if (corner < 0.5) {
          x = 72 + Math.random() * 20;
          y = 10 + Math.random() * 35;
        } else if (corner < 0.75) {
          x = 6 + Math.random() * 22;
          y = 58 + Math.random() * 30;
        } else {
          x = 72 + Math.random() * 20;
          y = 58 + Math.random() * 30;
        }
      } else {
        x = 52 + Math.random() * 34;
        y = 62 + Math.random() * (Y_MAX - 62);
      }
    }
    if (x >= A.x0 && x <= A.x1 && y >= A.y0 && y <= A.y1) continue;
    return { x, y };
  }
  return variant === 'auth' ? (mobile ? { x: 12, y: 16 } : { x: 14, y: 18 }) : mobile ? { x: 78, y: 72 } : { x: 82, y: 74 };
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fn = () => setReduced(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return reduced;
}

function useIsMobileLayout(): boolean {
  const [m, setM] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return m;
}

/**
 * Lightweight roaming Slime Buddy for the homepage landing and auth gate.
 * Overlay: pointer-events none except the slime control.
 */
export function HomeRoamingSlime({ variant = 'home' }: { variant?: HomeRoamingSlimeVariant }) {
  const navigate = useNavigate();
  const { slimeProfile } = useSlimeProfile();
  const profile = slimeProfile ?? DEFAULT_SLIME_PROFILE;
  const reducedMotion = usePrefersReducedMotion();
  const mobile = useIsMobileLayout();

  const [pos, setPos] = useState(() => pickWanderTarget(mobile, variant));
  const wanderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [excited, setExcited] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [hovering, setHovering] = useState(false);
  const navLockRef = useRef(false);

  useEffect(() => {
    setPos(
      reducedMotion
        ? variant === 'auth'
          ? mobile
            ? { x: 12, y: 18 }
            : { x: 16, y: 22 }
          : mobile
            ? { x: 78, y: 76 }
            : { x: 76, y: 70 }
        : pickWanderTarget(mobile, variant),
    );
  }, [mobile, reducedMotion, variant]);

  useEffect(() => {
    if (reducedMotion) {
      if (wanderTimeoutRef.current) window.clearTimeout(wanderTimeoutRef.current);
      return;
    }
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      const delay = 4200 + Math.random() * 5200;
      wanderTimeoutRef.current = window.setTimeout(() => {
        setPos(pickWanderTarget(mobile, variant));
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      if (wanderTimeoutRef.current) window.clearTimeout(wanderTimeoutRef.current);
    };
  }, [reducedMotion, mobile, variant]);

  const onNavigateBuddy = useCallback(() => {
    if (navLockRef.current) return;
    navLockRef.current = true;
    setExcited(true);
    window.setTimeout(() => navigate('/buddy?personalize=1'), 420);
  }, [navigate]);

  const tiltX = hovering ? (cursor.y - 0.5) * -6 : 0;
  const tiltY = hovering ? (cursor.x - 0.5) * 8 : 0;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[28]"
      data-testid="home-roaming-slime"
      aria-hidden={false}
    >
      <motion.div
        className="pointer-events-none fixed"
        initial={false}
        animate={{
          left: `${pos.x}vw`,
          top: `${pos.y}vh`,
          x: '-50%',
          y: '-50%',
        }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 28, damping: 19, mass: 1.05 }
        }
      >
        <div className="pointer-events-auto relative flex flex-col items-center">
          <span
            className={cn(
              'pointer-events-none mb-1 rounded-full border border-white/50 bg-white/75 px-2.5 py-0.5 text-[10px] font-medium text-violet-950/90 shadow-sm backdrop-blur-sm transition-opacity duration-200',
              hovering ? 'opacity-90' : 'opacity-0',
            )}
          >
            Visit your Slime Buddy
          </span>
          <motion.button
            type="button"
            data-testid="home-roaming-slime-hit"
            title="Visit your Slime Buddy"
            aria-label="Visit your Slime Buddy — open Slime studio"
            className={cn(
              'group relative flex cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 shadow-none outline-none transition-shadow',
              'focus-visible:ring-2 focus-visible:ring-violet-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
            )}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => {
              setHovering(false);
              setCursor({ x: 0, y: 0 });
            }}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const nx = (e.clientX - r.left) / r.width - 0.5;
              const ny = (e.clientY - r.top) / r.height - 0.5;
              setCursor({ x: Math.max(-1, Math.min(1, nx * 2)), y: Math.max(-1, Math.min(1, ny * 2)) });
            }}
            onClick={onNavigateBuddy}
            animate={
              excited
                ? {
                    scale: [1, 1.14, 1.05, 1],
                    rotate: [0, -7, 7, -4, 0],
                  }
                : reducedMotion
                  ? {}
                  : {
                      scale: [1, 1.04, 1],
                    }
            }
            transition={
              excited
                ? { duration: 0.42, ease: [0.34, 1.56, 0.64, 1] }
                : reducedMotion
                  ? {}
                  : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }
            }
          >
            <motion.div
              animate={
                reducedMotion
                  ? {}
                  : hovering
                    ? { filter: 'brightness(1.08) saturate(1.05)' }
                    : { filter: 'brightness(1) saturate(1)' }
              }
              style={{
                rotateX: tiltX,
                rotateY: tiltY,
                transformStyle: 'preserve-3d',
              }}
              transition={{ type: 'spring', stiffness: 380, damping: 24 }}
            >
              <SlimeAdvisor state="idle" size="sm" profile={profile} companionMode />
            </motion.div>
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
