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
      ? 'from-rose-400/60 to-orange-300/40'
      : tone === 'excited'
        ? 'from-amber-300/70 to-lime-300/40'
        : 'from-violet-400/55 to-cyan-300/45';

  return (
    <button
      type="button"
      data-date={date}
      data-has-entry={hasEntry ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      onClick={onSelect}
      className={cn(
        'relative flex flex-col items-center outline-none transition-transform focus-visible:ring-2 focus-visible:ring-violet-400/70',
        selected ? 'z-20 scale-110' : 'z-10',
        hasEntry ? '' : 'opacity-55',
      )}
      aria-current={selected ? 'date' : undefined}
      aria-label={`${label}${hasEntry ? ', diary entry' : ', no entry'}`}
    >
      <span
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-full border text-[11px] font-semibold shadow-md backdrop-blur-md sm:h-10 sm:w-10 sm:text-xs',
          hasEntry
            ? 'border-white/80 bg-gradient-to-br text-slate-900 shadow-violet-300/35 ' + toneHue
            : 'border-slate-200/90 bg-white/70 text-slate-500',
          selected && 'ring-2 ring-violet-400/90 ring-offset-2 ring-offset-transparent',
          prepareJump && selected && 'ring-violet-300 shadow-[0_0_22px_rgba(167,139,250,0.65)]',
        )}
      >
        {label}
        {hasEntry ? (
          <span className="absolute inset-0 animate-pulse rounded-full bg-white/25 opacity-40 [animation-duration:2.8s]" />
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
