import { useEffect, useRef } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { SlimeAdvisor } from '../../app/components/report/SlimeAdvisor';
import type { SlimeProfile } from '../../app/model';
import type { DiaryJumpPhase } from './types';
import type { SlotPoint } from './DiaryTrackViewport';

export type DiarySlimeWalkerProps = {
  /** Previous waypoint (strip-local); null = first paint / reduced path */
  anchorStart: SlotPoint | null;
  /** Target waypoint center on the path (strip-local px) */
  anchorEnd: SlotPoint;
  reducedMotion: boolean;
  slimeProfile: SlimeProfile | null;
  onPhaseChange?: (phase: DiaryJumpPhase) => void;
};

/** Lift slime so its base sits on the waypoint (path runs through node centers). */
function feetAnchor(p: SlotPoint): SlotPoint {
  return { x: p.x, y: p.y + 6 };
}

export function DiarySlimeWalker({
  anchorStart,
  anchorEnd,
  reducedMotion,
  slimeProfile,
  onPhaseChange,
}: DiarySlimeWalkerProps) {
  const end = feetAnchor(anchorEnd);
  const start = anchorStart ? feetAnchor(anchorStart) : null;

  const mx = useMotionValue(end.x);
  const my = useMotionValue(end.y);
  const sx = useMotionValue(1);
  const sy = useMotionValue(1);
  const rz = useMotionValue(0);

  const prevEnd = useRef(anchorEnd);
  const mounted = useRef(false);

  useEffect(() => {
    const samePt = prevEnd.current.x === anchorEnd.x && prevEnd.current.y === anchorEnd.y;
    if (samePt && mounted.current) return;
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
        return;
      }

      mx.set(start.x);
      my.set(start.y);

      onPhaseChange?.('preparing_jump');
      await Promise.all([
        animate(sx, 0.9, { duration: 0.14, ease: 'easeIn' }),
        animate(sy, 1.15, { duration: 0.14, ease: 'easeIn' }),
      ]);
      if (cancelled) return;

      onPhaseChange?.('jumping');
      const midX = (start.x + end.x) / 2;
      const jumpH = Math.min(92, 56 + Math.abs(end.x - start.x) * 0.12);
      await Promise.all([
        animate(mx, [start.x, midX, end.x], { duration: 0.52, times: [0, 0.45, 1], ease: ['easeIn', 'easeOut'] }),
        animate(my, [start.y, start.y - jumpH, end.y], { duration: 0.52, times: [0, 0.42, 1], ease: ['easeIn', 'easeOut'] }),
        animate(sy, [1.22, 0.92], { duration: 0.28, ease: 'easeOut' }),
        animate(rz, [0, dir * 5, 0], { duration: 0.52, times: [0, 0.35, 1] }),
      ]);
      if (cancelled) return;

      onPhaseChange?.('landing');
      await Promise.all([
        animate(sx, [1.06, 1], { duration: 0.24, ease: 'easeOut' }),
        animate(sy, [0.82, 1], { duration: 0.24, ease: 'easeOut' }),
        animate(rz, 0, { duration: 0.2 }),
      ]);
      if (cancelled) return;

      onPhaseChange?.('idle');
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    anchorEnd.x,
    anchorEnd.y,
    anchorStart?.x,
    anchorStart?.y,
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
          className="pointer-events-none absolute bottom-0 left-1/2 h-3 w-10 -translate-x-1/2 translate-y-1/2 rounded-[50%] bg-violet-900/15 blur-[3px]"
        />
        <div className="origin-bottom scale-[0.54] sm:scale-[0.6]">
          <SlimeAdvisor state="idle" size="sm" profile={slimeProfile ?? undefined} />
        </div>
      </div>
    </motion.div>
  );
}
