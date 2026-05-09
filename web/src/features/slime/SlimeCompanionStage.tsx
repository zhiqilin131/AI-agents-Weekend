import { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { SlimeAdvisor, type SlimeAdvisorState } from '../../app/components/report/SlimeAdvisor';
import type { SlimeProfile } from '../../app/model';

function pickRoamTarget() {
  const rx = Math.min((typeof window !== 'undefined' ? window.innerWidth : 400) * 0.28, 220);
  const ry = Math.min((typeof window !== 'undefined' ? window.innerHeight : 600) * 0.2, 150);
  return { x: (Math.random() - 0.5) * 2 * rx, y: (Math.random() - 0.5) * 2 * ry };
}

/**
 * Roaming pet: wander, hide/pop, play bursts; drag springs home; tap wiggles.
 * Buddy motion is 2D-only inside SlimeAdvisor (bounce / squash / faces) — no 3D card spin.
 */
export function SlimeCompanionStage({
  profile,
  advisorState = 'idle',
}: {
  profile: SlimeProfile;
  advisorState?: SlimeAdvisorState;
}) {
  const roamX = useMotionValue(0);
  const roamY = useMotionValue(0);
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const fade = useMotionValue(1);
  const squish = useMotionValue(1);
  const [wiggle, setWiggle] = useState(0);
  const [playBurst, setPlayBurst] = useState(0);
  const draggingRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let tid: ReturnType<typeof setTimeout>;

    const schedule = () => {
      if (cancelledRef.current) return;
      const wait = reduced ? 5200 + Math.random() * 9000 : 2600 + Math.random() * 4800;
      tid = window.setTimeout(async () => {
        if (cancelledRef.current) return;
        if (draggingRef.current) {
          schedule();
          return;
        }
        const { x: tx, y: ty } = pickRoamTarget();
        const r = Math.random();
        try {
          if (!reduced && r < 0.11) {
            await Promise.all([
              animate(fade, 0, { duration: 0.34, ease: 'easeIn' }),
              animate(squish, 0.7, { duration: 0.34, ease: 'easeIn' }),
            ]);
            roamX.set(tx);
            roamY.set(ty);
            await Promise.all([
              animate(fade, 1, { type: 'spring', stiffness: 280, damping: 24 }),
              animate(squish, 1, { type: 'spring', stiffness: 300, damping: 22 }),
            ]);
          } else if (!reduced && r < 0.22) {
            setPlayBurst((n) => n + 1);
            await new Promise((res) => window.setTimeout(res, 880));
          } else {
            await Promise.all([
              animate(roamX, tx, { type: 'spring', stiffness: 22, damping: 19, mass: 1.05 }),
              animate(roamY, ty, { type: 'spring', stiffness: 22, damping: 19, mass: 1.05 }),
            ]);
          }
        } catch {
          /* ignore */
        }
        schedule();
      }, wait);
    };

    schedule();
    return () => {
      cancelledRef.current = true;
      window.clearTimeout(tid);
    };
  }, []);

  return (
    <div className="relative h-full min-h-[280px] w-full overflow-visible">
      <motion.div className="absolute left-1/2 top-1/2 z-10" style={{ x: roamX, y: roamY }}>
        <motion.div
          className="-translate-x-1/2 -translate-y-1/2"
          style={{
            x: dragX,
            y: dragY,
            opacity: fade,
            scale: squish,
            touchAction: 'none',
            cursor: 'grab',
          }}
          drag
          dragMomentum={false}
          dragElastic={0.12}
          dragConstraints={{ left: -175, right: 175, top: -130, bottom: 145 }}
          whileDrag={{ cursor: 'grabbing' }}
          onDragStart={() => {
            draggingRef.current = true;
          }}
          onDragEnd={() => {
            void Promise.all([
              animate(dragX, 0, { type: 'spring', stiffness: 28, damping: 20, mass: 1.1 }),
              animate(dragY, 0, { type: 'spring', stiffness: 28, damping: 20, mass: 1.1 }),
            ]).then(() => {
              draggingRef.current = false;
            });
          }}
          onTap={() => setWiggle((n) => n + 1)}
        >
          <motion.div
            key={playBurst}
            className="relative"
            initial={false}
            animate={
              playBurst > 0
                ? { y: [0, -10, 0, -6, 0], scaleY: [1, 0.88, 1.1, 0.95, 1], scaleX: [1, 1.06, 0.96, 1.04, 1] }
                : { y: 0, scaleY: 1, scaleX: 1 }
            }
            transition={{ duration: playBurst > 0 ? 0.75 : 0, ease: 'easeInOut' }}
          >
            <motion.div
              key={wiggle}
              initial={wiggle === 0 ? false : { x: 0, scale: 1 }}
              animate={wiggle > 0 ? { x: [0, -9, 9, -6, 6, 0], scale: [1, 1.06, 1.04, 1] } : { x: 0, scale: 1 }}
              transition={{ duration: wiggle > 0 ? 0.48 : 0 }}
            >
              <SlimeAdvisor state={advisorState} size="lg" profile={profile} companionMode />
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
