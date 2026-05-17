import { useNavigate } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { BuddyTooltip } from '../../../features/slime/BuddyTooltip';
import { cn } from '../ui/utils';

/** Home landing — bottom-left entry to the FOR-17 resilience judge report. */
export function HomeResilienceNavButton({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();

  return (
    <BuddyTooltip content="Resilience report for judges — architecture, chaos timeline, and a safe smoke test.">
      <button
        type="button"
        onClick={() => navigate('/resilience')}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-sky-200/90 bg-white/95 shadow-md backdrop-blur-md transition',
          'hover:border-sky-400 hover:bg-sky-50/90 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40',
          compact ? 'px-2.5 py-2 text-[10px] font-semibold' : 'px-3.5 py-2.5 text-xs font-semibold',
          className,
        )}
        style={{ overflow: 'visible', lineHeight: 1 }}
        aria-label="Resilience Report"
      >
        <ShieldCheck
          className={cn('shrink-0 text-sky-600', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')}
          aria-hidden
        />
        <span className="text-slate-800">{compact ? 'Resilience' : 'Resilience Report'}</span>
      </button>
    </BuddyTooltip>
  );
}
