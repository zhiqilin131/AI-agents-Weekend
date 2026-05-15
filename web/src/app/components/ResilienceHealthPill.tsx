import { Activity } from 'lucide-react';
import { useResilienceHealth } from '../../hooks/useResilienceHealth';
import { cn } from './ui/utils';

const STYLE = {
  green: {
    label: 'Stable',
    dot: 'bg-emerald-500',
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  },
  yellow: {
    label: 'Safe mode',
    dot: 'bg-amber-400',
    cls: 'border-amber-200 bg-amber-50 text-amber-950',
  },
  red: {
    label: 'Degraded',
    dot: 'bg-rose-500',
    cls: 'border-rose-200 bg-rose-50 text-rose-950',
  },
} as const;

export function ResilienceHealthPill({ compact = false }: { compact?: boolean }) {
  const { level, failed } = useResilienceHealth();
  const s = STYLE[level];
  const title = failed
    ? 'Resilience health endpoint is unreachable.'
    : level === 'green'
      ? 'All resilience checks are healthy.'
      : 'Fallbacks or circuit breakers are active.';

  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border shadow-sm backdrop-blur-sm',
        compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs',
        s.cls,
      )}
      title={title}
      aria-label={`Resilience status: ${s.label}`}
    >
      <span className={cn('h-2 w-2 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.75)]', s.dot)} />
      <Activity className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      <span className="font-semibold">{s.label}</span>
    </div>
  );
}
