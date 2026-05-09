/** Must match ExecutionPlannerPage localStorage keys */
export const EXECUTION_EVENTS_STORAGE_KEY = 'fx.execution.events.v1';
export const EXECUTION_TASKS_STORAGE_KEY = 'fx.execution.tasks.v1';
/** Last merged Schedule coach / scheduler options (accumulates across Re-plan until Clear). */
export const EXECUTION_SCHEDULE_COACH_OPTIONS_KEY = 'fx.execution.scheduleCoachOptions.v1';
/** Set from Shadow Chat when user wants to continue in the planner */
export const EXECUTION_PENDING_CALENDAR_FEEDBACK_KEY = 'fx.execution.pendingCalendarFeedback';
/** Resolved start/end from Slime voice — place exact block when user taps Edit */
export const SLIME_VOICE_CALENDAR_RESOLVED_KEY = 'fx.slime.calendarResolved.v1';
/** Selected AI task ids + labels when opening chat from execution calendar (session). */
export const EXECUTION_SELECTED_BLOCKS_CONTEXT_KEY = 'fx.execution.selectedBlocksContext.v1';

/** Full Calendar Agent draft payload when opening planner from report or Slime. */
export const CALENDAR_AGENT_SESSION_DRAFT_KEY = 'fx.calendarAgent.sessionDraft.v1';
