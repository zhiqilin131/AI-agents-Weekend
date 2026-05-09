import { useCallback, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { CalendarAgentDraft } from '../../../utils/calendarAgentApi';
import { confirmCalendarDraft, fetchCalendarAlternatives } from '../../../utils/calendarAgentApi';
import { CalendarConflictCard } from './CalendarConflictCard';
import { CalendarDraftCard } from './CalendarDraftCard';
import { ScheduleAlternatives } from './ScheduleAlternatives';

type PlannerEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  source: 'uploaded' | 'ai' | 'manual';
  description?: string;
  locked?: boolean;
};

function agentConfirmedToPlanner(ev: Record<string, unknown>): PlannerEvent {
  return {
    id: String(ev.id ?? `evt-${Date.now()}`),
    title: String(ev.title ?? 'Event'),
    start: String(ev.start ?? ''),
    end: String(ev.end ?? ''),
    source: 'manual',
    description: typeof ev.description === 'string' ? ev.description : undefined,
    locked: false,
  };
}

export function CalendarAgentPanel({
  draft,
  onDismiss,
  onEventsConfirmed,
}: {
  draft: CalendarAgentDraft;
  onDismiss: () => void;
  onEventsConfirmed: (events: PlannerEvent[]) => void;
}) {
  const [localDraft, setLocalDraft] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primary = localDraft.proposed_events[0] as Record<string, string> | undefined;
  const conflicts = (localDraft.conflicts || []) as Array<{ message?: string; severity?: string }>;

  const confidenceLabel = useMemo(() => {
    const c = localDraft.confidence;
    if (c == null) return undefined;
    if (c >= 0.8) return 'Looks like a solid match';
    if (c >= 0.55) return 'Please double-check times';
    return 'Low confidence — confirm before saving';
  }, [localDraft.confidence]);

  const onAdd = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const events = await confirmCalendarDraft(localDraft.draft_id);
      onEventsConfirmed(events.map(agentConfirmedToPlanner));
      onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm');
    } finally {
      setBusy(false);
    }
  }, [localDraft.draft_id, onDismiss, onEventsConfirmed]);

  const onSuggest = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const alts = await fetchCalendarAlternatives(localDraft.draft_id, 'earlier');
      const first = alts[0] as { proposed_events?: Array<Record<string, unknown>> } | undefined;
      const pe = first?.proposed_events;
      if (pe?.length) {
        setLocalDraft((d) => ({ ...d, proposed_events: pe as typeof d.proposed_events, conflicts: [] }));
      } else {
        setError('No alternative found — try adjusting in the grid.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Alternatives failed');
    } finally {
      setBusy(false);
    }
  }, [localDraft.draft_id]);

  if (!primary?.start || !primary?.end) {
    return (
      <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
        Draft has no proposed times. Close and try again.
        <button type="button" className="ml-2 underline" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-[24px] border border-indigo-200/70 bg-white/80 p-4 shadow-[0_12px_36px_rgba(99,102,241,0.12)] backdrop-blur-sm">
      <div className="flex items-center gap-2 text-indigo-900">
        <Sparkles className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
        <p className="text-sm font-semibold">Calendar Agent</p>
      </div>
      {localDraft.explanation ? <p className="mt-1 text-xs leading-relaxed text-slate-600">{localDraft.explanation}</p> : null}

      {conflicts.length ? (
        <div className="mt-2 space-y-2">
          {conflicts.slice(0, 2).map((c, i) => (
            <CalendarConflictCard key={i} message={c.message || 'Conflict'} severity={c.severity} />
          ))}
        </div>
      ) : null}

      <div className="mt-3">
        <CalendarDraftCard
          title={String(primary.title ?? 'Event')}
          start={primary.start}
          end={primary.end}
          explanation={undefined}
          confidenceLabel={confidenceLabel}
          onAdd={() => void onAdd()}
          onEdit={onDismiss}
          onSuggest={() => void onSuggest()}
          onCancel={onDismiss}
          busy={busy}
        />
      </div>

      <ScheduleAlternatives
        alternatives={(localDraft.alternatives || []) as Array<{ label: string; tradeoff_summary?: string; score?: number }>}
        busy={busy}
        onPick={() => void onSuggest()}
      />

      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
