/** Legacy keys (pre per-account isolation). Not read by the app anymore. */
export const EXECUTION_EVENTS_STORAGE_KEY = 'fx.execution.events.v1';
export const EXECUTION_TASKS_STORAGE_KEY = 'fx.execution.tasks.v1';
export const EXECUTION_SCHEDULE_COACH_OPTIONS_KEY = 'fx.execution.scheduleCoachOptions.v1';

/** Safe segment for localStorage key suffix (matches server calendar filename sanitization spirit). */
export function sanitizeExecutionStorageSegment(raw: string): string {
  const s = raw.trim();
  if (!s) return 'anon';
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export function executionStorageKeys(storageUserKey: string) {
  const seg = sanitizeExecutionStorageSegment(storageUserKey);
  return {
    events: `fx.execution.events.v1.${seg}`,
    tasks: `fx.execution.tasks.v1.${seg}`,
    coachOptions: `fx.execution.scheduleCoachOptions.v1.${seg}`,
  } as const;
}

/** Fired after execution calendar `events` in localStorage change in this tab (e.g. Slime Add). Planner must rehydrate React state — storage events don't fire for same-document writes. */
export const EXECUTION_CALENDAR_LOCAL_BUMP_EVENT = 'fx.execution.calendarLocalBump.v1';

export function dispatchExecutionCalendarLocalBump(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EXECUTION_CALENDAR_LOCAL_BUMP_EVENT));
}
/** Set from Shadow Chat when user wants to continue in the planner */
export const EXECUTION_PENDING_CALENDAR_FEEDBACK_KEY = 'fx.execution.pendingCalendarFeedback';
/** Resolved start/end from Slime voice — place exact block when user taps Edit */
export const SLIME_VOICE_CALENDAR_RESOLVED_KEY = 'fx.slime.calendarResolved.v1';
/** Selected AI task ids + labels when opening chat from execution calendar (session). */
export const EXECUTION_SELECTED_BLOCKS_CONTEXT_KEY = 'fx.execution.selectedBlocksContext.v1';

/** Full Calendar Agent draft payload when opening planner from report or Slime. */
export const CALENDAR_AGENT_SESSION_DRAFT_KEY = 'fx.calendarAgent.sessionDraft.v1';
/** Calendar context handoff from planner into Slime Buddy voice/chat. */
export const SLIME_CALENDAR_BRIEF_CONTEXT_KEY = 'fx.slime.calendarBriefContext.v1';
