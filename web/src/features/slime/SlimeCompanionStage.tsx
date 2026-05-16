import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { SlimeAdvisor, type SlimeAdvisorState } from '../../app/components/report/SlimeAdvisor';
import { cn } from '../../app/components/ui/utils';
import type { SlimeProfile } from '../../app/model';
import type { MemoryEvidenceItem } from '../../app/components/profile/memoryEvidenceTypes';
import type { SlimeDecisionSuggestion, SlimeSpeechOutput } from './SlimeVoiceAgent';

/** Approximate radius of the slime “body” for obstacle clearance (viewport px). */
const SLIME_FOOTPRINT_RADIUS = 78;
const AVOID_RECT_PADDING = 10;
const ROAM_SAMPLE_TRIES = 28;
/** Buddy anchor: vertical fraction of stage (from top). 0.5 = centered in the stage; roam offsets apply from here. */
const SLIME_ANCHOR_Y_FRAC = 0.5;
/** Roam step default (px); larger for hide/pop teleport. */
const ROAM_STEP_DEFAULT = 62;
const ROAM_STEP_TELEPORT = 130;

function collectAvoidRects(): Array<{ left: number; top: number; right: number; bottom: number }> {
  if (typeof document === 'undefined') return [];
  const out: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  document.querySelectorAll<HTMLElement>('[data-slime-avoid]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return;
    out.push({
      left: r.left - AVOID_RECT_PADDING,
      top: r.top - AVOID_RECT_PADDING,
      right: r.right + AVOID_RECT_PADDING,
      bottom: r.bottom + AVOID_RECT_PADDING,
    });
  });
  return out;
}

function circleIntersectsRect(cx: number, cy: number, radius: number, R: { left: number; top: number; right: number; bottom: number }) {
  const nx = Math.max(R.left, Math.min(cx, R.right));
  const ny = Math.max(R.top, Math.min(cy, R.bottom));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < radius * radius;
}

/** Keep slime center (offset ox,oy from anchor) inside stage rect with margin. */
function clampOffsetToStage(stageEl: HTMLElement | null, ox: number, oy: number): { x: number; y: number } {
  if (!stageEl || typeof window === 'undefined') return { x: ox, y: oy };
  const S = stageEl.getBoundingClientRect();
  const margin = SLIME_FOOTPRINT_RADIUS + 12;
  const anchorVx = S.left + S.width / 2;
  const anchorVy = S.top + S.height * SLIME_ANCHOR_Y_FRAC;
  const slimeCx = anchorVx + ox;
  const slimeCy = anchorVy + oy;
  const clampedCx = Math.min(Math.max(slimeCx, S.left + margin), S.right - margin);
  const clampedCy = Math.min(Math.max(slimeCy, S.top + margin), S.bottom - margin);
  return { x: clampedCx - anchorVx, y: clampedCy - anchorVy };
}

function computeDragLimits(stageEl: HTMLElement | null, roamXv: number, roamYv: number) {
  if (!stageEl || typeof window === 'undefined') {
    return { left: -175, right: 175, top: -175, bottom: 175 };
  }
  const S = stageEl.getBoundingClientRect();
  const margin = SLIME_FOOTPRINT_RADIUS + 12;
  const anchorVx = S.left + S.width / 2;
  const anchorVy = S.top + S.height * SLIME_ANCHOR_Y_FRAC;
  let left = S.left + margin - anchorVx - roamXv;
  let right = S.right - margin - anchorVx - roamXv;
  let top = S.top + margin - anchorVy - roamYv;
  let bottom = S.bottom - margin - anchorVy - roamYv;
  if (left > right) [left, right] = [right, left];
  if (top > bottom) [top, bottom] = [bottom, top];
  return { left, right, top, bottom };
}

/** Small wander step from current offset; stays on-screen and avoids `[data-slime-avoid]` rects. */
function pickSafeRoamDelta(
  stageEl: HTMLElement | null,
  curX: number,
  curY: number,
  maxStep: number = ROAM_STEP_DEFAULT,
): { x: number; y: number } {
  if (!stageEl || typeof window === 'undefined') {
    const dx = (Math.random() - 0.5) * maxStep * 1.4;
    const dy = -Math.random() * maxStep * 0.85 + Math.random() * maxStep * 0.35;
    return { x: curX + dx, y: curY + dy };
  }

  const rects = collectAvoidRects();
  const r = SLIME_FOOTPRINT_RADIUS;
  const S = stageEl.getBoundingClientRect();
  const anchorVx = S.left + S.width / 2;
  const anchorVy = S.top + S.height * SLIME_ANCHOR_Y_FRAC;
  const hitsObstacle = (vx: number, vy: number) => rects.some((R) => circleIntersectsRect(vx, vy, r, R));

  for (let i = 0; i < ROAM_SAMPLE_TRIES; i++) {
    const dx = (Math.random() - 0.5) * 2 * maxStep;
    const dy = -Math.random() * maxStep * 0.95 + Math.random() * maxStep * 0.38;
    let nx = curX + dx;
    let ny = curY + dy;
    const cl = clampOffsetToStage(stageEl, nx, ny);
    nx = cl.x;
    ny = cl.y;
    if (!hitsObstacle(anchorVx + nx, anchorVy + ny)) return { x: nx, y: ny };
  }

  return clampOffsetToStage(stageEl, curX, curY);
}

function memoryChipLabel(item: MemoryEvidenceItem): string {
  const genericLabel = /^(profile|memory|evidence|chat history|decision report|calendar)(\s+memory)?$/i;
  const fromLabel = item.label?.trim();
  const raw = fromLabel && !genericLabel.test(fromLabel)
    ? fromLabel
    : (item.shortText || item.fullText || fromLabel || 'memory').trim();
  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/^(profile|memory|evidence|chat history|decision report|calendar)\s*[:·-]\s*/i, '')
    .replace(/^(the\s+)?user\s+(prefers|likes|wants|plans|asked|mentioned|said|is|has|calls|thinks|feels)\s+/i, '')
    .trim();
  if (!cleaned) return 'memory';
  return cleaned.length > 34 ? `${cleaned.slice(0, 31).trim()}…` : cleaned;
}

/**
 * Roaming pet: wander from current spot; drag merges into roam (no snap-back); clamped to stage.
 */
export function SlimeCompanionStage({
  profile,
  advisorState = 'idle',
  speechOutput,
  decisionSuggestion,
  onEvidenceOpen,
  className,
}: {
  profile: SlimeProfile;
  advisorState?: SlimeAdvisorState;
  speechOutput?: SlimeSpeechOutput | null;
  decisionSuggestion?: SlimeDecisionSuggestion | null;
  onEvidenceOpen?: () => void;
  /** Merged onto the stage root (e.g. z-index vs voice UI layers). */
  className?: string;
}) {
  const roamX = useMotionValue(0);
  /** Offset from stage anchor; 0 = anchor center (see SLIME_ANCHOR_Y_FRAC). */
  const roamY = useMotionValue(0);
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const fade = useMotionValue(1);
  const squish = useMotionValue(1);
  const [wiggle, setWiggle] = useState(0);
  const [playBurst, setPlayBurst] = useState(0);
  const draggingRef = useRef(false);
  const cancelledRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [dragLim, setDragLim] = useState({ left: -175, right: 175, top: -175, bottom: 175 });

  const clampRoamIntoStage = () => {
    const el = stageRef.current;
    if (!el || draggingRef.current) return;
    const cl = clampOffsetToStage(el, roamX.get(), roamY.get());
    roamX.set(cl.x);
    roamY.set(cl.y);
  };

  /** Every visit to Slime Buddy: start at stage center (no carry-over offset), then roam kicks in after the usual delay. */
  useLayoutEffect(() => {
    roamX.set(0);
    roamY.set(0);
    dragX.set(0);
    dragY.set(0);
    fade.set(1);
    squish.set(1);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    clampRoamIntoStage();
    const ro = new ResizeObserver(() => clampRoamIntoStage());
    ro.observe(el);
    window.addEventListener('resize', clampRoamIntoStage);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', clampRoamIntoStage);
    };
  }, []);

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
        const curX = roamX.get();
        const curY = roamY.get();
        const r = Math.random();
        try {
          if (!reduced && r < 0.11) {
            const { x: tx, y: ty } = pickSafeRoamDelta(stageRef.current, curX, curY, ROAM_STEP_TELEPORT);
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
            const { x: tx, y: ty } = pickSafeRoamDelta(stageRef.current, curX, curY, ROAM_STEP_DEFAULT);
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
    <div
      ref={stageRef}
      className={cn(
        'pointer-events-none relative h-full min-h-[280px] w-full overflow-visible',
        className,
      )}
    >
      <motion.div
        className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ x: roamX, y: roamY }}
      >
        <motion.div
          className="relative"
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
          dragElastic={0.06}
          dragConstraints={dragLim}
          whileDrag={{ cursor: 'grabbing' }}
          onDragStart={() => {
            draggingRef.current = true;
            setDragLim(computeDragLimits(stageRef.current, roamX.get(), roamY.get()));
          }}
          onDragEnd={() => {
            const nx = roamX.get() + dragX.get();
            const ny = roamY.get() + dragY.get();
            const cl = clampOffsetToStage(stageRef.current, nx, ny);
            roamX.set(cl.x);
            roamY.set(cl.y);
            dragX.set(0);
            dragY.set(0);
            draggingRef.current = false;
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
            {speechOutput?.text ? (
              <motion.div
                key={`${speechOutput.source}:${speechOutput.utteranceId ?? speechOutput.text}`}
                initial={{ opacity: 0, y: 10, scale: 0.92, rotate: -1.5 }}
                animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                className={cn(
                  'slime-comic-bubble pointer-events-auto absolute left-[72%] top-[-18%] z-20 max-w-[min(78vw,34rem)]',
                  speechOutput.source === 'error' && 'slime-comic-bubble-error',
                  speechOutput.source === 'system' && 'slime-comic-bubble-system',
                )}
              >
                <p className="whitespace-pre-wrap break-words text-[15px] font-medium leading-relaxed text-slate-800">
                  {speechOutput.text}
                </p>
                {speechOutput.evidenceItems?.length ? (
                  <div className="mt-3 flex max-w-full flex-wrap gap-1.5 border-t border-violet-100/80 pt-2">
                    {speechOutput.evidenceItems.slice(0, 3).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="max-w-full truncate rounded-full border border-violet-200/75 bg-violet-50/85 px-2 py-1 text-[10px] font-semibold text-violet-800 shadow-sm transition hover:border-violet-300 hover:bg-white"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEvidenceOpen?.();
                        }}
                        title={item.fullText || item.shortText || item.label}
                      >
                        remembered: {memoryChipLabel(item)}
                      </button>
                    ))}
                    {speechOutput.evidenceItems.length > 3 ? (
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-white"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEvidenceOpen?.();
                        }}
                      >
                        +{speechOutput.evidenceItems.length - 3}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {decisionSuggestion?.should_show ? (
                  <p className="mt-2 border-t border-fuchsia-100/80 pt-2 text-[11px] leading-snug text-violet-800/90">
                    Decision report ready — confirm below when you want the full report.
                  </p>
                ) : null}
              </motion.div>
            ) : null}
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
