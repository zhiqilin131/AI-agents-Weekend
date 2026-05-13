import { useEffect, useRef } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { SlimeAdvisor } from '../../app/components/report/SlimeAdvisor';
import type { SlimeProfile } from '../../app/model';
import type { DiaryJumpPhase } from './types';
import type { SlotPoint } from './DiaryTrackViewport';

export type DiarySlimeWalkerProps = {
  /** Previous waypoint (strip-local); null = infer from last landing or first paint */
  anchorStart: SlotPoint | null;
  /** Target waypoint center on the path (strip-local px) */
  anchorEnd: SlotPoint;
  reducedMotion: boolean;
  slimeProfile: SlimeProfile | null;
  onPhaseChange?: (phase: DiaryJumpPhase) => void;
};

/** Anchor slime feet near the path point (waypoint center); negative y pulls it onto the node/track. */
function feetAnchor(p: SlotPoint): SlotPoint {
  return { x: p.x, y: p.y - 10 };
}

export function DiarySlimeWalker({
  anchorStart,
  anchorEnd,
  reducedMotion,
  slimeProfile,
  onPhaseChange,
}: DiarySlimeWalkerProps) {
  const end = feetAnchor(anchorEnd);
  const startFromProp = anchorStart ? feetAnchor(anchorStart) : null;

  const mx = useMotionValue(end.x);
  const my = useMotionValue(end.y);
  const sx = useMotionValue(1);
  const sy = useMotionValue(1);
  const rz = useMotionValue(0);

  const prevEnd = useRef(anchorEnd);
  const mounted = useRef(false);
  const lastFeetRef = useRef<SlotPoint | null>(null);

  useEffect(() => {
    const start = startFromProp ?? (mounted.current && lastFeetRef.current ? lastFeetRef.current : null);

    const samePt = prevEnd.current.x === anchorEnd.x && prevEnd.current.y === anchorEnd.y;
    if (samePt && mounted.current) {
      mx.set(end.x);
      my.set(end.y);
      sx.set(1);
      sy.set(1);
      rz.set(0);
      lastFeetRef.current = end;
      return;
    }
    mounted.current = true;
    prevEnd.current = anchorEnd;

    let cancelled = false;
    const dir = start ? Math.sign(end.x - start.x) || 1 : 1;

    const run = async () => {
      if (reducedMotion || !start) {
        onPhaseChange?.('idle');
        mx.set(end.x);
        my.set(end.y);
        sx.set(1);
        sy.set(1);
        rz.set(0);
        await Promise.all([
          animate(mx, end.x, { duration: 0.22 }),
          animate(my, end.y, { duration: 0.22 }),
        ]);
        lastFeetRef.current = end;
        return;
      }

      mx.set(start.x);
      my.set(start.y);
      sx.set(1);
      sy.set(1);
      rz.set(0);

      onPhaseChange?.('preparing_jump');
      await Promise.all([
        animate(sx, 0.88, { duration: 0.16, ease: 'easeIn' }),
        animate(sy, 1.22, { duration: 0.16, ease: 'easeIn' }),
      ]);
      if (cancelled) return;

      onPhaseChange?.('jumping');
      const midX = (start.x + end.x) / 2;
      const span = Math.abs(end.x - start.x);
      const jumpH = Math.min(108, 72 + span * 0.14);
      await Promise.all([
        animate(mx, [start.x, midX, end.x], {
          duration: 0.62,
          times: [0, 0.46, 1],
          ease: ['easeIn', 'easeOut'],
        }),
        animate(my, [start.y, start.y - jumpH, end.y], {
          duration: 0.62,
          times: [0, 0.42, 1],
          ease: ['easeIn', 'easeOut'],
        }),
        animate(sx, [1.08, 0.92, 1.02], {
          duration: 0.62,
          times: [0, 0.38, 1],
          ease: ['easeInOut', 'easeOut'],
        }),
        animate(sy, [0.88, 1.18, 1], {
          duration: 0.62,
          times: [0, 0.36, 1],
          ease: ['easeInOut', 'easeOut'],
        }),
        animate(rz, [0, dir * 7, 0], {
          duration: 0.62,
          times: [0, 0.38, 1],
          ease: ['easeInOut', 'easeOut'],
        }),
      ]);
      if (cancelled) return;

      onPhaseChange?.('landing');
      await Promise.all([
        animate(sx, [1.12, 1], { duration: 0.28, ease: 'easeOut' }),
        animate(sy, [0.78, 1], { duration: 0.28, ease: 'easeOut' }),
        animate(rz, 0, { duration: 0.22 }),
      ]);
      if (cancelled) return;

      onPhaseChange?.('idle');
      lastFeetRef.current = end;

      // Landed on a new day: small vertical hop then body wiggle (skip on first paint / snap moves).
      if (start && !reducedMotion) {
        await animate(my, [end.y, end.y - 18, end.y - 6, end.y], {
          duration: 0.5,
          times: [0, 0.28, 0.58, 1],
          ease: ['easeOut', 'easeInOut', 'easeOut'],
        });
        if (cancelled) return;
        await Promise.all([
          animate(rz, [0, -11, 11, -8, 8, -5, 5, 0], {
            duration: 0.52,
            ease: 'easeInOut',
          }),
          animate(sy, [1, 1.06, 1.04, 1], { duration: 0.52, times: [0, 0.25, 0.55, 1], ease: 'easeInOut' }),
        ]);
        if (cancelled) return;
      }

      mx.set(end.x);
      my.set(end.y);
      sx.set(1);
      sy.set(1);
      rz.set(0);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    anchorEnd.x,
    anchorEnd.y,
    startFromProp?.x,
    startFromProp?.y,
    end.x,
    end.y,
    reducedMotion,
    mx,
    my,
    sx,
    sy,
    rz,
    onPhaseChange,
  ]);

  return (
    <motion.div
      data-testid="diary-slime-walker"
      className="pointer-events-none absolute left-0 top-0 z-40"
      style={{
        x: mx,
        y: my,
        scaleX: sx,
        scaleY: sy,
        rotate: rz,
      }}
    >
      <div className="-translate-x-1/2 -translate-y-full">
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-1/2 h-4 w-11 -translate-x-1/2 translate-y-[55%] rounded-[50%] bg-violet-600/20 blur-[5px]"
        />
        <div className="origin-bottom scale-[0.66] sm:scale-[0.74]">
          <SlimeAdvisor state="idle" size="sm" profile={slimeProfile ?? undefined} />
        </div>
      </div>
    </motion.div>
  );
}
