import type { EvidenceReference, EvidenceRefType } from '../../model';
import { cn } from '../ui/utils';

function labelFor(t: EvidenceRefType): string {
  switch (t) {
    case 'profile':
      return 'Profile';
    case 'past_decision':
      return 'Past decision';
    case 'current_constraint':
      return 'Constraint';
    case 'memory':
      return 'Memory';
    case 'user_statement':
      return 'What you said';
    default:
      return 'Note';
  }
}

export function EvidenceChips({
  refs,
  className,
  interactive = false,
  onChipClick,
}: {
  refs: EvidenceReference[];
  className?: string;
  /** When true, chips are buttons and open the parent’s detail popover via `onChipClick`. */
  interactive?: boolean;
  onChipClick?: (ref: EvidenceReference) => void;
}) {
  if (!refs.length) return null;
  return (
    <ul className={cn('flex flex-wrap gap-1.5 mt-2', className)} aria-label="Sources">
      {refs.slice(0, 6).map((r, i) => {
        const short = r.text.length > 72 ? `${r.text.slice(0, 72)}…` : r.text;
        const inner = (
          <>
            <span className="text-violet-600/90 font-semibold">{labelFor(r.type)}</span>
            <span className="text-violet-950/85"> · </span>
            <span className="text-violet-950/90">{short}</span>
          </>
        );
        if (interactive && onChipClick) {
          return (
            <li key={`${r.type}-${i}-${r.text.slice(0, 24)}`} className="max-w-full">
              <button
                type="button"
                onClick={() => onChipClick(r)}
                className="max-w-full rounded-lg border border-violet-200 bg-violet-50/90 px-2 py-1.5 text-left text-[11px] text-violet-950 leading-snug transition-colors hover:border-violet-400 hover:bg-violet-100/90"
                title="View full memory / source"
              >
                {inner}
              </button>
            </li>
          );
        }
        return (
          <li
            key={`${r.type}-${i}-${r.text.slice(0, 24)}`}
            className="max-w-full rounded-lg border border-violet-100 bg-violet-50/80 px-2 py-1 text-[11px] text-violet-950 leading-snug"
            title={r.text}
          >
            {inner}
          </li>
        );
      })}
    </ul>
  );
}
