import { motion } from 'motion/react';
import { cn } from '../../app/components/ui/utils';

export type DiaryTrackNodeProps = {
  date: string;
  label: string;
  hasEntry: boolean;
  selected: boolean;
  tone?: string | null;
  landingRipple: boolean;
  reducedMotion: boolean;
  /** Squash cue before slime jumps away */
  prepareJump?: boolean;
  onSelect: () => void;
};

export function DiaryTrackNode({
  date,
  label,
  hasEntry,
  selected,
  tone,
  landingRipple,
  reducedMotion,
  prepareJump,
  onSelect,
}: DiaryTrackNodeProps) {
  const toneHue =
    tone === 'stressed'
      ? 'from-rose-200 via-orange-100 to-white'
      : tone === 'excited'
        ? 'from-amber-100 via-lime-50 to-white'
        : tone === 'focused'
          ? 'from-cyan-100 via-sky-50 to-white'
          : 'from-violet-100 via-cyan-50 to-white';

  return (
    <button
      type="button"
      data-date={date}
      data-has-entry={hasEntry ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col items-center outline-none transition-transform focus-visible:ring-2 focus-visible:ring-violet-400/70',
        selected ? 'z-20 scale-110' : 'z-10',
        hasEntry ? '' : 'opacity-[0.82]',
      )}
      aria-current={selected ? 'date' : undefined}
      aria-label={`${label}${hasEntry ? ', diary entry' : ', no entry'}`}
    >
      <span
        className={cn(
          'relative z-[1] flex h-11 w-11 items-center justify-center rounded-full border text-xs font-semibold shadow-lg backdrop-blur-sm transition sm:h-12 sm:w-12 sm:text-sm',
          hasEntry
            ? 'border-white/90 bg-gradient-to-br text-slate-950 shadow-violet-400/25 ring-1 ring-white/80 ' + toneHue
            : 'border-slate-200/90 bg-white/82 text-slate-500 shadow-slate-200/50',
          selected && 'shadow-[0_18px_44px_rgba(124,58,237,0.22)] ring-2 ring-violet-400/90 ring-offset-4 ring-offset-white/45',
          prepareJump && selected && 'ring-violet-300 shadow-[0_0_22px_rgba(167,139,250,0.65)]',
        )}
      >
        {hasEntry ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-[-3px] z-0 rounded-full bg-violet-400/12 [animation-duration:2.6s] animate-pulse"
          />
        ) : null}
        <span className="relative z-[2] drop-shadow-[0_1px_0_rgba(255,255,255,0.85)]">{label}</span>
        {hasEntry ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.75)]"
          />
        ) : null}
      </span>
      {!reducedMotion && landingRipple ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-300/60 bg-violet-400/15"
          initial={{ scale: 0.6, opacity: 0.85 }}
          animate={{ scale: 2.2, opacity: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
        />
      ) : null}
    </button>
  );
}
