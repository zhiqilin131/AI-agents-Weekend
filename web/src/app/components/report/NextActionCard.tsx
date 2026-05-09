import { useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, ListTodo } from 'lucide-react';
import type { PrimaryNextAction } from '../../model';
import { durationEstimateForAction } from '../../../utils/reportSurfaceFromTrace';
import { cn } from '../ui/utils';

export type NextActionRow = { text: string; deadline?: string };

export function NextActionCard({
  actions,
  fallbackPrimary,
  decisionId,
  onExecutionCalendarNavigate,
  navigate,
  suppressCalendarButton = false,
}: {
  /** All recommended next steps (same order as the report). */
  actions: NextActionRow[];
  /** When `actions` is empty, show this single synthetic step. */
  fallbackPrimary?: PrimaryNextAction;
  decisionId: string;
  onExecutionCalendarNavigate?: (decisionId: string) => void;
  navigate: (path: string) => void;
  /** When true, calendar CTA lives on recommendation resource chips instead */
  suppressCalendarButton?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => {
    if (actions.length > 0) return actions;
    if (fallbackPrimary?.text) {
      return [
        {
          text: fallbackPrimary.text,
          deadline: fallbackPrimary.deadline,
        },
      ];
    }
    return [];
  }, [actions, fallbackPrimary]);

  const goCal = () =>
    decisionId
      ? onExecutionCalendarNavigate
        ? onExecutionCalendarNavigate(decisionId)
        : navigate(`/execution/${encodeURIComponent(decisionId)}`)
      : undefined;

  if (rows.length === 0) return null;

  const first = rows[0];
  const rest = rows.slice(1);
  const firstDuration =
    actions.length > 0
      ? durationEstimateForAction(first.text, first.deadline)
      : fallbackPrimary?.durationEstimate ?? durationEstimateForAction(first.text, first.deadline);

  return (
    <section className="rounded-2xl border border-indigo-200/90 bg-gradient-to-br from-indigo-50/70 to-white/85 backdrop-blur-md p-5 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 shadow-md">
          <ListTodo className="h-5 w-5 text-white" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-gray-900">Next steps</h3>
          <p className="mt-0.5 text-xs text-gray-600">
            {rows.length} step{rows.length === 1 ? '' : 's'} · start with the first, then open the list for the rest.
          </p>
          <p className="mt-1 text-xs font-medium text-indigo-800/90">{firstDuration}</p>
        </div>
      </div>

      <div className="rounded-xl border border-indigo-100 bg-white/90 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Step 1</p>
        <p className="mt-1 text-sm font-semibold leading-relaxed text-gray-900">{first.text}</p>
        {first.deadline ? (
          <p className="mt-2 text-xs font-semibold text-indigo-800">Deadline cue: {first.deadline}</p>
        ) : null}
      </div>

      {rest.length > 0 ? (
        <div className="rounded-xl border border-gray-200/90 bg-white/70">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-gray-800 hover:bg-gray-50/80"
            aria-expanded={expanded}
          >
            <span>
              {rest.length} more step{rest.length === 1 ? '' : 's'} (collapsed)
            </span>
            <ChevronDown
              className={cn('h-4 w-4 shrink-0 text-gray-500 transition-transform', expanded && 'rotate-180')}
              aria-hidden
            />
          </button>
          {expanded ? (
            <ol className="space-y-3 border-t border-gray-100 px-4 py-3 text-sm text-gray-800">
              {rest.map((a, j) => {
                const i = j + 1;
                return (
                  <li key={`step-${i}`} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-900">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="leading-relaxed">{a.text}</p>
                      <p className="mt-1 text-[11px] text-gray-500">
                        {durationEstimateForAction(a.text, a.deadline)}
                        {a.deadline ? <span className="text-gray-600"> · {a.deadline}</span> : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      ) : null}

      {decisionId && !suppressCalendarButton ? (
        <button
          type="button"
          onClick={goCal}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border border-indigo-300 bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700',
          )}
        >
          <CalendarClock className="h-4 w-4" aria-hidden />
          Add to Execution Calendar
        </button>
      ) : null}
    </section>
  );
}
