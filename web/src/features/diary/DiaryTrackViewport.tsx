import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { DiaryTrackNode } from './DiaryTrackNode';
import type { DiaryJumpPhase, DiaryMonthDay } from './types';

export type SlotPoint = { x: number; y: number };

export type DiaryTrackViewportProps = {
  visibleDays: DiaryMonthDay[];
  selectedDate: string | null;
  onSelectDate: (d: string) => void;
  landingRippleDate: string | null;
  reducedMotion: boolean;
  jumpPhase: DiaryJumpPhase;
  /** Highlight path between two slot indices while jumping */
  jumpSegment: { from: number; to: number } | null;
  viewportWidth: number;
  /** Anchored overlay (slime) rendered in strip-local coordinates */
  children?: ReactNode;
};

const SLOT_W = 112;
const STRIP_H = 260;
const NODE_CY = 152;
const WAVE_AMP = 40;

function slotCenterX(i: number): number {
  return i * SLOT_W + SLOT_W / 2;
}

function pathFromPoints(points: SlotPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const cx = (p0.x + p1.x) / 2;
    const cy = (p0.y + p1.y) / 2 - 20;
    d += ` Q ${cx} ${cy} ${p1.x} ${p1.y}`;
  }
  return d;
}

function buildPath(n: number): { d: string; points: SlotPoint[] } {
  const points: SlotPoint[] = [];
  for (let i = 0; i < n; i++) {
    points.push({
      x: slotCenterX(i),
      y: NODE_CY + WAVE_AMP * Math.sin(i * 0.85 + 0.4),
    });
  }
  return { d: pathFromPoints(points), points };
}

export function diaryViewportStripWidth(visibleCount: number): number {
  return Math.max(visibleCount, 1) * SLOT_W;
}

export function diarySlotAnchorForDate(
  visibleDays: DiaryMonthDay[],
  date: string | null,
): SlotPoint | null {
  if (!date) return null;
  const ix = visibleDays.findIndex((x) => x.date === date);
  if (ix < 0) return null;
  const { points } = buildPath(visibleDays.length);
  return points[ix] ?? null;
}

export function diarySelectedSlotIndex(visibleDays: DiaryMonthDay[], selectedDate: string | null): number {
  if (!selectedDate) return 0;
  const ix = visibleDays.findIndex((x) => x.date === selectedDate);
  return ix < 0 ? 0 : ix;
}

/**
 * Moving journey strip: only ``visibleDays`` rendered; translates so selection stays near viewport center.
 */
export function DiaryTrackViewport({
  visibleDays,
  selectedDate,
  onSelectDate,
  landingRippleDate,
  reducedMotion,
  jumpPhase,
  jumpSegment,
  viewportWidth,
  children,
}: DiaryTrackViewportProps) {
  const gradId = useId().replace(/:/g, '');
  const glowId = useId().replace(/:/g, '');
  const focusGradId = `fg-${gradId}`;
  const stripRef = useRef<HTMLDivElement | null>(null);
  const stripX = useMotionValue(0);
  const [measuredW, setMeasuredW] = useState(viewportWidth || 360);

  useEffect(() => {
    if (viewportWidth > 0) setMeasuredW(viewportWidth);
  }, [viewportWidth]);

  const measure = useCallback(() => {
    const el = stripRef.current?.parentElement;
    if (!el) return;
    const w = el.getBoundingClientRect().width;
    if (w > 0) setMeasuredW(w);
  }, []);

  useEffect(() => {
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    const el = stripRef.current?.parentElement;
    if (ro && el) ro.observe(el);
    return () => ro?.disconnect();
  }, [measure, visibleDays.length]);

  const n = visibleDays.length;
  const { d: pathD, points } = useMemo(() => buildPath(n), [n]);
  const selIx = diarySelectedSlotIndex(visibleDays, selectedDate);
  const stripW = diaryViewportStripWidth(n);

  useEffect(() => {
    const vw = measuredW;
    const cx = slotCenterX(selIx);
    const target = vw / 2 - cx;
    if (reducedMotion) {
      stripX.set(target);
      return;
    }
    void animate(stripX, target, { type: 'spring', stiffness: 420, damping: 38, mass: 0.85 });
  }, [selIx, measuredW, stripX, reducedMotion, visibleDays]);

  const segmentPath = useMemo(() => {
    if (!jumpSegment || jumpSegment.from < 0 || jumpSegment.to < 0) return '';
    const a = Math.min(jumpSegment.from, jumpSegment.to);
    const b = Math.max(jumpSegment.from, jumpSegment.to);
    const slice = points.slice(a, b + 1);
    return pathFromPoints(slice);
  }, [jumpSegment, points]);

  return (
    <div
      data-testid="diary-track-viewport"
      data-visible-count={n}
      className="relative mx-auto w-full overflow-hidden pb-10 pt-4"
      style={{ height: STRIP_H + 96 }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-4 bottom-10 rounded-lg border border-white/80 bg-white/48 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_24px_80px_rgba(79,70,229,0.10)] backdrop-blur-md">
        <div className="absolute inset-0 rounded-lg opacity-[0.42] [background-image:linear-gradient(rgba(124,58,237,0.11)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.10)_1px,transparent_1px)] [background-size:34px_34px]" />
        <div className="absolute inset-x-8 top-1/2 h-px bg-gradient-to-r from-transparent via-violet-300/50 to-transparent" />
      </div>
      <div className="pointer-events-none absolute left-5 top-7">
        <span className="rounded-full border border-violet-100/90 bg-white/76 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-600 shadow-sm backdrop-blur-sm">
          Timefield
        </span>
      </div>

      <motion.div ref={stripRef} className="absolute left-0 top-12 will-change-transform" style={{ x: stripX, width: stripW }}>
        <svg width={stripW} height={STRIP_H} className="overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(139, 92, 246, 0.28)" />
              <stop offset="50%" stopColor="rgba(56, 189, 248, 0.38)" />
              <stop offset="100%" stopColor="rgba(167, 139, 250, 0.28)" />
            </linearGradient>
            <linearGradient id={glowId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(167, 139, 250, 0.05)" />
              <stop offset="50%" stopColor="rgba(196, 181, 253, 0.95)" />
              <stop offset="100%" stopColor="rgba(167, 139, 250, 0.05)" />
            </linearGradient>
            <linearGradient id={focusGradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(129, 140, 248, 0.95)" />
              <stop offset="45%" stopColor="rgba(56, 189, 248, 0.85)" />
              <stop offset="100%" stopColor="rgba(167, 139, 250, 0.75)" />
            </linearGradient>
          </defs>
          {/* Soft trail under the route */}
          <path
            d={pathD}
            fill="none"
            stroke="rgba(139, 92, 246, 0.18)"
            strokeWidth={24}
            strokeLinecap="round"
            opacity={0.95}
          />
          {/* Upcoming / faint portion */}
          <path
            d={pathD}
            fill="none"
            stroke="rgba(148, 163, 184, 0.35)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray="3 20"
            opacity={0.65}
          />
          <motion.path
            data-testid="diary-journey-path"
            d={pathD}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray="7 16"
            opacity={0.98}
            initial={{ strokeDashoffset: 0 }}
            animate={
              reducedMotion
                ? { strokeDashoffset: 0 }
                : { strokeDashoffset: [0, -140] }
            }
            transition={
              reducedMotion
                ? { duration: 0 }
                : { duration: 18, repeat: Infinity, ease: 'linear' }
            }
          />
          {(jumpPhase === 'jumping' || jumpPhase === 'preparing_jump') && segmentPath ? (
            <path
              data-testid="diary-journey-path-jump-glow"
              d={segmentPath}
              fill="none"
              stroke={`url(#${glowId})`}
              strokeWidth={12}
              strokeLinecap="round"
              opacity={0.92}
            />
          ) : null}
          {selIx >= 1 ? (
            <path
              d={pathFromPoints(points.slice(0, selIx + 1))}
              fill="none"
              stroke={`url(#${focusGradId})`}
              strokeWidth={8}
              strokeLinecap="round"
              opacity={0.88}
            />
          ) : null}
        </svg>

        {visibleDays.map((d, i) => {
          const p = points[i];
          if (!p) return null;
          const [y, mo, day] = d.date.split('-').map(Number);
          const edge = i === 0 || i === n - 1;
          return (
            <div
              key={d.date}
              className={edge ? 'opacity-[0.78]' : ''}
              style={{
                position: 'absolute',
                left: p.x,
                top: p.y,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <DiaryTrackNode
                date={d.date}
                label={String(day)}
                hasEntry={d.has_entry}
                selected={selectedDate === d.date}
                tone={d.tone}
                landingRipple={landingRippleDate === d.date}
                reducedMotion={reducedMotion}
                prepareJump={jumpPhase === 'preparing_jump' && selectedDate === d.date}
                onSelect={() => onSelectDate(d.date)}
              />
              <span className="pointer-events-none absolute left-1/2 top-12 h-7 w-px -translate-x-1/2 bg-gradient-to-b from-violet-200/80 to-transparent" />
              <span className="pointer-events-none absolute -bottom-6 left-1/2 w-max -translate-x-1/2 text-[9px] font-medium uppercase tracking-wide text-slate-400">
                {new Date(y, mo - 1, day).toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
            </div>
          );
        })}

        {children}
      </motion.div>
    </div>
  );
}
