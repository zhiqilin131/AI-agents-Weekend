"use client";

import type { CSSProperties } from 'react';
import { CalendarClock, ExternalLink, Link2, Sparkles } from 'lucide-react';
import type { ResourceDrop } from '../../model';
import { RESOURCE_DROP_CALENDAR_ID } from '../../model';
import { cn } from '../ui/utils';

export function ResourceDropChip({
  drop,
  style,
  className,
  onInternalCalendar,
}: {
  drop: ResourceDrop;
  style?: CSSProperties;
  className?: string;
  onInternalCalendar?: () => void;
}) {
  const isCal = drop.id === RESOURCE_DROP_CALENDAR_ID || drop.action_type === 'calendar';

  const icon =
    isCal ? (
      <CalendarClock className="h-3.5 w-3.5 shrink-0 text-indigo-600" aria-hidden />
    ) : drop.source === 'tavily' ? (
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
    ) : (
      <Link2 className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
    );

  const body = (
    <>
      {icon}
      <span className="min-w-0 truncate font-medium">{drop.title}</span>
      {drop.source === 'tavily' ? (
        <span className="shrink-0 rounded bg-violet-100 px-1 py-0 text-[9px] font-semibold uppercase tracking-wide text-violet-800">
          web
        </span>
      ) : null}
    </>
  );

  if (isCal) {
    return (
      <button
        type="button"
        style={style}
        data-testid="resource-chip-calendar"
        onClick={() => onInternalCalendar?.()}
        className={cn(
          'inline-flex max-w-[min(100%,14rem)] items-center gap-1.5 rounded-full border border-indigo-200/90 bg-white/95 px-2.5 py-1 text-left text-[11px] text-indigo-950 shadow-sm transition hover:bg-indigo-50/90',
          className,
        )}
      >
        {body}
      </button>
    );
  }

  if (!drop.url) {
    return (
      <span
        style={style}
        className={cn(
          'inline-flex max-w-[min(100%,14rem)] items-center gap-1.5 rounded-full border border-gray-200/90 bg-white/80 px-2.5 py-1 text-[11px] text-gray-700',
          className,
        )}
      >
        {body}
      </span>
    );
  }

  return (
    <a
      href={drop.url}
      target="_blank"
      rel="noopener noreferrer"
      style={style}
      data-testid="resource-chip-external"
      className={cn(
        'inline-flex max-w-[min(100%,14rem)] items-center gap-1.5 rounded-full border border-gray-200/90 bg-white/95 px-2.5 py-1 text-[11px] text-gray-900 shadow-sm transition hover:bg-violet-50/80',
        className,
      )}
    >
      {body}
      <ExternalLink className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />
    </a>
  );
}
