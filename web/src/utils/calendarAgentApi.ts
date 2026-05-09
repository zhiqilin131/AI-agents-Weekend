import { apiUrl } from './apiOrigin';

export type CalendarAgentDraft = {
  draft_id: string;
  intent: Record<string, unknown>;
  proposed_events: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  alternatives: Array<Record<string, unknown>>;
  requires_confirmation?: boolean;
  explanation?: string;
  confidence?: number;
  tasks?: Array<Record<string, unknown>>;
};

export async function fetchCalendarDraftFromReport(decisionId: string, threadId?: string | null): Promise<CalendarAgentDraft> {
  const res = await fetch(apiUrl('/api/calendar-agent/from-report'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision_id: decisionId, thread_id: threadId ?? null }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { draft?: CalendarAgentDraft };
  if (!data.draft) throw new Error('No draft returned');
  return data.draft;
}

export async function confirmCalendarDraft(
  draftId: string,
  opts?: { selected_event_ids?: string[]; edits?: Array<Record<string, unknown>> },
): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(apiUrl('/api/calendar-agent/confirm'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      draft_id: draftId,
      selected_event_ids: opts?.selected_event_ids,
      edits: opts?.edits,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { events?: Array<Record<string, unknown>> };
  return data.events ?? [];
}

export async function fetchCalendarAlternatives(
  draftId: string,
  preference: 'earlier' | 'less_intense' | 'later' | 'focus_time',
): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(apiUrl('/api/calendar-agent/alternatives'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft_id: draftId, preference }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { alternatives?: Array<Record<string, unknown>> };
  return data.alternatives ?? [];
}
