import type { CalendarEvent } from './executionScheduler';
import type { CalendarAgentDraft } from './calendarAgentApi';
import { confirmCalendarDraft, fetchCalendarDraftFromReport } from './calendarAgentApi';
import { CALENDAR_AGENT_SESSION_DRAFT_KEY } from './executionStorageKeys';

export function parseCalendarSessionDraft(raw: string): CalendarAgentDraft | null {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const nested = obj.draft;
  if (nested && typeof nested === 'object' && typeof (nested as CalendarAgentDraft).draft_id === 'string') {
    return nested as CalendarAgentDraft;
  }
  if (typeof obj.draft_id === 'string') return obj as CalendarAgentDraft;
  return null;
}

export function mapAgentEventsToPlanner(events: Array<Record<string, unknown>>): CalendarEvent[] {
  return events
    .map((ev) => {
      const start = String(ev.start ?? '');
      const end = String(ev.end ?? '');
      if (!start || !end) return null;
      return {
        id: String(ev.id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        title: String(ev.title ?? 'Event').slice(0, 200),
        start,
        end,
        source: 'ai' as const,
        description: typeof ev.description === 'string' ? ev.description : undefined,
        locked: false,
      };
    })
    .filter((x): x is CalendarEvent => x != null);
}

export function draftHasSchedulableTimes(draft: CalendarAgentDraft): boolean {
  return (draft.proposed_events ?? []).some((ev) => {
    const start = ev.start;
    const end = ev.end;
    return typeof start === 'string' && start && typeof end === 'string' && end;
  });
}

/** Read session handoff from report / Slime, else fetch a fresh draft from the API. */
export async function loadCalendarDraftForPlanner(
  decisionId: string,
  threadId?: string | null,
): Promise<CalendarAgentDraft | null> {
  try {
    const raw = sessionStorage.getItem(CALENDAR_AGENT_SESSION_DRAFT_KEY);
    if (raw) {
      sessionStorage.removeItem(CALENDAR_AGENT_SESSION_DRAFT_KEY);
      const parsed = parseCalendarSessionDraft(raw);
      if (parsed?.draft_id) return parsed;
    }
  } catch {
    // ignore parse / quota errors
  }
  try {
    return await fetchCalendarDraftFromReport(decisionId, threadId ?? null);
  } catch {
    return null;
  }
}

/** Confirm a calendar-agent draft and map events for the execution planner grid. */
export async function applyCalendarDraftToPlanner(
  draft: CalendarAgentDraft,
): Promise<{ events: CalendarEvent[]; message: string }> {
  if (!draftHasSchedulableTimes(draft)) {
    return { events: [], message: '' };
  }
  const confirmed = await confirmCalendarDraft(draft.draft_id);
  const events = mapAgentEventsToPlanner(confirmed);
  if (events.length === 0) {
    return { events: [], message: '' };
  }
  const message = draft.explanation?.trim()
    ? `Added ${events.length} block(s) from your report plan. ${draft.explanation.trim()}`
    : `Added ${events.length} block(s) from your report plan.`;
  return { events, message };
}
