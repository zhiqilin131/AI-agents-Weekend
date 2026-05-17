import { apiFetch } from './apiFetch';
import { mapAgentEventsToPlanner } from './calendarAgentApply';
import type { CalendarEvent } from './executionScheduler';
import {
  dispatchExecutionCalendarLocalBump,
  EXECUTION_CALENDAR_FOCUS_WEEK_KEY,
  executionStorageKeys,
} from './executionStorageKeys';

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
  const res = await apiFetch('/api/calendar-agent/from-report', {
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
  const res = await apiFetch('/api/calendar-agent/confirm', {
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

/** Merge confirmed calendar-agent events into execution planner localStorage. */
export function mergeExecutionCalendarEvents(
  storageUserKey: string,
  events: Array<Record<string, unknown>>,
): CalendarEvent[] {
  const incoming = mapAgentEventsToPlanner(events);
  if (!storageUserKey?.trim() || !incoming.length) return incoming;
  try {
    const k = executionStorageKeys(storageUserKey).events;
    const raw = localStorage.getItem(k);
    let existing: CalendarEvent[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          existing = mapAgentEventsToPlanner(parsed.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>);
        }
      } catch {
        existing = [];
      }
    }
    const ids = new Set(existing.map((e) => e.id));
    const merged = [...existing];
    let focusStart: string | undefined;
    for (const ev of incoming) {
      if (!ids.has(ev.id)) {
        merged.push(ev);
        ids.add(ev.id);
        focusStart ??= ev.start;
      }
    }
    localStorage.setItem(k, JSON.stringify(merged));
    dispatchExecutionCalendarLocalBump();
    if (focusStart && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(EXECUTION_CALENDAR_FOCUS_WEEK_KEY, focusStart);
    }
  } catch {
    /* ignore */
  }
  return incoming;
}

/**
 * Parse natural language → calendar-agent draft → confirm → persist to execution calendar.
 */
export async function scheduleTextOnExecutionCalendar(
  text: string,
  storageUserKey: string,
  opts?: { threadId?: string | null },
): Promise<Array<Record<string, unknown>>> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Nothing to schedule');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const parseRes = await apiFetch('/api/calendar-agent/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: trimmed,
      thread_id: opts?.threadId ?? null,
      source: 'therapy_report',
    }),
  });
  if (!parseRes.ok) throw new Error(await parseRes.text());
  const parsed = (await parseRes.json()) as { intent?: Record<string, unknown> };
  const intent = parsed.intent ?? {};
  const draftRes = await apiFetch('/api/calendar-agent/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: {
        ...intent,
        intent_type: intent.intent_type ?? 'create_event',
        title:
          typeof intent.title === 'string' && intent.title.trim()
            ? intent.title
            : trimmed.slice(0, 120),
      },
      timezone,
    }),
  });
  if (!draftRes.ok) throw new Error(await draftRes.text());
  const draftData = (await draftRes.json()) as { draft?: CalendarAgentDraft };
  const draftId = draftData.draft?.draft_id;
  if (!draftId) throw new Error('No calendar draft returned');
  const events = await confirmCalendarDraft(draftId);
  mergeExecutionCalendarEvents(storageUserKey, events);
  return events;
}

export async function fetchCalendarAlternatives(
  draftId: string,
  preference: 'earlier' | 'less_intense' | 'later' | 'focus_time',
): Promise<Array<Record<string, unknown>>> {
  const res = await apiFetch('/api/calendar-agent/alternatives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft_id: draftId, preference }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { alternatives?: Array<Record<string, unknown>> };
  return data.alternatives ?? [];
}
