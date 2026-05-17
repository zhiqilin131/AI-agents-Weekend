import { cn } from './ui/utils';

type BrandMarkProps = {
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
};

/**
 * Keeps the logo legible on bright and gradient surfaces.
 * We place the wordmark on a dark glass chip to preserve contrast.
 */
export function BrandMark({ compact = false, iconOnly = false, className }: BrandMarkProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-white/25 bg-slate-950/86 shadow-[0_10px_28px_rgba(15,23,42,0.28)] ring-1 ring-violet-200/35 backdrop-blur-md',
        compact ? 'gap-1.5 px-1.5 py-1' : 'gap-2 px-2.5 py-1.5',
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full bg-white/96 ring-1 ring-violet-200/70',
          compact ? 'h-6 w-6' : 'h-7 w-7',
        )}
      >
        <img
          src="/ForesightXIconDark.svg"
          alt=""
          aria-hidden
          decoding="async"
          className={cn(compact ? 'h-4 w-4' : 'h-[18px] w-[18px]')}
        />
      </span>
      {!iconOnly ? (
        <img
          src="/ForesightXLogoDark.svg"
          alt=""
          aria-hidden
          decoding="async"
          className={cn(
            'pointer-events-none w-auto select-none max-[430px]:hidden',
            compact ? 'h-4 opacity-95' : 'h-5 opacity-100',
          )}
        />
      ) : (
        <span className="sr-only">Foresight-X</span>
      )}
    </span>
  );
}
