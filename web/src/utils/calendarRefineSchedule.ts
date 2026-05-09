import { apiUrl } from './apiOrigin';
import {
  EXECUTION_EVENTS_STORAGE_KEY,
  EXECUTION_SCHEDULE_COACH_OPTIONS_KEY,
  EXECUTION_TASKS_STORAGE_KEY,
} from './executionStorageKeys';
import { taskIdFromAiCalendarEventId } from './executionCalendarSelection';

/** Default window aligned with ExecutionPlannerPage */
export const DEFAULT_PLANNER_SCHEDULE_OPTIONS = {
  day_start_hour: 9,
  day_end_hour: 22,
  slot_minutes: 30,
  days: 7,
  min_gap_minutes: 10,
  max_ai_blocks_per_day: 0,
  allowed_weekdays: [] as const,
} as const;

export type PlannerCoachOptions = {
  day_start_hour: number;
  day_end_hour: number;
  slot_minutes: number;
  days: number;
  min_gap_minutes: number;
  max_ai_blocks_per_day: number;
  /** Empty = any day; else 0=Mon … 6=Sun (matches backend). */
  allowed_weekdays: number[];
};

function _clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Normalize API / storage payload into safe planner options (defaults fill gaps). */
export function normalizePlannerCoachOptions(o: Record<string, unknown> | null | undefined): PlannerCoachOptions {
  const d = DEFAULT_PLANNER_SCHEDULE_OPTIONS;
  const slot = Number(o?.slot_minutes ?? d.slot_minutes);
  const slotOk = [15, 20, 30, 45, 60].includes(slot) ? slot : d.slot_minutes;
  let dayStart = _clamp(Number(o?.day_start_hour ?? d.day_start_hour), 0, 22);
  let dayEnd = _clamp(Number(o?.day_end_hour ?? d.day_end_hour), 1, 24);
  if (dayEnd <= dayStart) dayEnd = Math.min(24, dayStart + 1);
  let allowed: number[] = [];
  const rawAw = o?.allowed_weekdays;
  if (Array.isArray(rawAw)) {
    allowed = [...new Set(rawAw.map((x) => _clamp(Number(x), 0, 6)).filter((x) => !Number.isNaN(x)))].sort(
      (a, b) => a - b,
    );
  }
  return {
    day_start_hour: dayStart,
    day_end_hour: dayEnd,
    slot_minutes: slotOk,
    days: _clamp(Number(o?.days ?? d.days), 1, 14),
    min_gap_minutes: _clamp(Number(o?.min_gap_minutes ?? d.min_gap_minutes), 0, 120),
    max_ai_blocks_per_day: _clamp(Number(o?.max_ai_blocks_per_day ?? 0), 0, 12),
    allowed_weekdays: allowed,
  };
}

/** Load accumulated coach constraints (merged with defaults). */
export function loadCoachSchedulerOptions(): PlannerCoachOptions {
  try {
    const raw = localStorage.getItem(EXECUTION_SCHEDULE_COACH_OPTIONS_KEY);
    if (!raw) return normalizePlannerCoachOptions({});
    const o = JSON.parse(raw) as Record<string, unknown>;
    return normalizePlannerCoachOptions(o);
  } catch {
    return normalizePlannerCoachOptions({});
  }
}

export function saveCoachSchedulerOptions(opts: PlannerCoachOptions): void {
  try {
    localStorage.setItem(EXECUTION_SCHEDULE_COACH_OPTIONS_KEY, JSON.stringify(opts));
  } catch {
    // ignore
  }
}

/** Merge API schedule back into in-memory calendar (full replan vs partial targets). */
export function mergeEventsAfterRefine<T extends { id: string; source: string }>(
  prev: T[],
  scheduled: T[],
  targetTaskIds?: string[] | null,
): T[] {
  const targetSet = new Set((targetTaskIds ?? []).filter(Boolean));
  if (targetSet.size === 0) {
    return [...prev.filter((e) => e.source !== 'ai'), ...scheduled];
  }
  const busy = prev.filter((e) => e.source !== 'ai');
  const keptAi = prev.filter((e) => {
    if (e.source !== 'ai') return false;
    const tid = taskIdFromAiCalendarEventId(e.id);
    return Boolean(tid && !targetSet.has(tid));
  });
  return [...busy, ...keptAi, ...scheduled];
}

export function buildRefineExistingEventsPayload(
  plannerEvents: CalendarEventPayload[],
  targetTaskIds?: string[] | null,
): CalendarEventPayload[] {
  const busy = plannerEvents.filter((e) => e.source !== 'ai');
  const targets = new Set((targetTaskIds ?? []).filter(Boolean));
  if (targets.size === 0) return busy;
  const pinnedAi = plannerEvents.filter((e) => {
    if (e.source !== 'ai') return false;
    const tid = taskIdFromAiCalendarEventId(e.id);
    return tid != null && !targets.has(tid);
  });
  return [...busy, ...pinnedAi];
}

export type CalendarEventPayload = {
  id: string;
  title: string;
  start: string;
  end: string;
  source: string;
  description?: string;
  locked?: boolean;
};

export type ExecutionTaskPayload = {
  id: string;
  title: string;
  duration_minutes: number;
  description?: string;
  priority?: string;
  deadline_hint?: string;
};

export type RefineScheduleResponse = {
  interpretation: string;
  notes: string[];
  adjusted_options: Record<string, unknown>;
  /** Task backlog after quote-based removals (sync to planner storage). */
  tasks_input?: ExecutionTaskPayload[];
  schedule: {
    scheduled_events?: CalendarEventPayload[];
    unscheduled_tasks?: ExecutionTaskPayload[];
    warnings?: string[];
  };
};

export async function refineScheduleWithFeedback(params: {
  feedback: string;
  tasks: ExecutionTaskPayload[];
  /** Full planner calendar (uploaded + AI); used to pin non-target AI blocks when targeting. */
  plannerEvents: CalendarEventPayload[];
  /** When set, only these execution tasks are re-placed; other AI blocks stay fixed. */
  targetTaskIds?: string[] | null;
  options: PlannerCoachOptions;
}): Promise<RefineScheduleResponse> {
  const existingPayload = buildRefineExistingEventsPayload(params.plannerEvents, params.targetTaskIds);
  const body: Record<string, unknown> = {
    feedback: params.feedback,
    tasks: params.tasks,
    existing_events: existingPayload,
    options: {
      day_start_hour: params.options.day_start_hour,
      day_end_hour: params.options.day_end_hour,
      slot_minutes: params.options.slot_minutes,
      days: params.options.days,
      min_gap_minutes: params.options.min_gap_minutes,
      max_ai_blocks_per_day: params.options.max_ai_blocks_per_day,
      allowed_weekdays: params.options.allowed_weekdays,
    },
  };
  const tt = (params.targetTaskIds ?? []).filter(Boolean);
  if (tt.length > 0) body.target_task_ids = tt;

  const res = await fetch(apiUrl('/api/calendar/refine-schedule'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as RefineScheduleResponse;
}

/** Persist planner state like ExecutionPlannerPage.runAutoSchedule */
export function mergeRefinedScheduleIntoStorage(
  res: RefineScheduleResponse,
  opts?: { targetTaskIds?: string[] | null },
): void {
  const schedule = res.schedule;
  const scheduled = schedule.scheduled_events ?? [];
  const targetSet = new Set((opts?.targetTaskIds ?? []).filter(Boolean));
  try {
    const raw = localStorage.getItem(EXECUTION_EVENTS_STORAGE_KEY);
    const existing = (raw ? JSON.parse(raw) : []) as CalendarEventPayload[];
    let next: CalendarEventPayload[];
    if (!Array.isArray(existing)) {
      next = [...scheduled];
    } else if (targetSet.size === 0) {
      const kept = existing.filter((e) => e.source !== 'ai');
      next = [...kept, ...scheduled];
    } else {
      const busy = existing.filter((e) => e.source !== 'ai');
      const keptAi = existing.filter((e) => {
        if (e.source !== 'ai') return false;
        const tid = taskIdFromAiCalendarEventId(e.id);
        return Boolean(tid && !targetSet.has(tid));
      });
      next = [...busy, ...keptAi, ...scheduled];
    }
    localStorage.setItem(EXECUTION_EVENTS_STORAGE_KEY, JSON.stringify(next));
    if (Array.isArray(res.tasks_input) && res.tasks_input.length >= 0) {
      localStorage.setItem(EXECUTION_TASKS_STORAGE_KEY, JSON.stringify(res.tasks_input));
    }
    if (res.adjusted_options && typeof res.adjusted_options === 'object') {
      saveCoachSchedulerOptions(normalizePlannerCoachOptions(res.adjusted_options as Record<string, unknown>));
    }
  } catch {
    // ignore
  }
}

export function readExecutionPlannerSnapshot(): {
  tasks: ExecutionTaskPayload[];
  events: CalendarEventPayload[];
} {
  try {
    const te = localStorage.getItem(EXECUTION_TASKS_STORAGE_KEY);
    const ev = localStorage.getItem(EXECUTION_EVENTS_STORAGE_KEY);
    return {
      tasks: te ? (JSON.parse(te) as ExecutionTaskPayload[]) : [],
      events: ev ? (JSON.parse(ev) as CalendarEventPayload[]) : [],
    };
  } catch {
    return { tasks: [], events: [] };
  }
}
