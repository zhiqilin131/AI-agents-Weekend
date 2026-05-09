import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Home,
  MessageSquare,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { addDays, addMinutes, differenceInMinutes, format, isSameDay, parseISO, setHours, setMinutes, startOfDay, startOfWeek } from 'date-fns';
import { apiUrl } from '../utils/apiOrigin';
import { MainNavButtons } from '../app/components/MainNavButtons';
import { buildLocalAgilityPreview, mapPreviewStepsToTasks, type AgilityPreview } from '../utils/agilityPreview';
import { AgilityPreview as AgilityPreviewCard } from '../app/components/AgilityPreview';
import { CalendarUpload } from '../app/components/CalendarUpload';
import {
  hasConflict,
  scheduleTasksIntoFreeSlots,
  suggestAlternativeSlot,
  type CalendarEvent,
  type ExecutionTask,
} from '../utils/executionScheduler';
import { parseIcsToCalendarEvents, exportEventsToIcs } from '../utils/ics';
import { mapRecommendationActionsToTasks } from '../utils/executionTasks';
import {
  EXECUTION_EVENTS_STORAGE_KEY,
  EXECUTION_PENDING_CALENDAR_FEEDBACK_KEY,
  EXECUTION_SCHEDULE_COACH_OPTIONS_KEY,
  EXECUTION_TASKS_STORAGE_KEY,
} from '../utils/executionStorageKeys';
import {
  loadCoachSchedulerOptions,
  mergeEventsAfterRefine,
  mergeRefinedScheduleIntoStorage,
  normalizePlannerCoachOptions,
  refineScheduleWithFeedback,
  type PlannerCoachOptions,
} from '../utils/calendarRefineSchedule';
import { saveSelectedBlocksContext, taskIdFromAiCalendarEventId } from '../utils/executionCalendarSelection';

type TraceShape = {
  decision_id: string;
  recommendation?: {
    chosen_option_id?: string;
    reasoning?: string;
    next_actions?: Array<{ action: string; deadline?: string | null }>;
  };
  options?: Array<{ option_id: string; name: string }>;
  rationality?: { detected_biases?: string[] };
};

const SCHEDULER_DAY_START_HOUR = 9;
const SCHEDULER_DAY_END_HOUR = 22;
const VIEW_DAY_START_HOUR = 0;
const VIEW_DAY_END_HOUR = 24;
const SLOT_MINUTES = 30;
const SLOT_COUNT = (VIEW_DAY_END_HOUR - VIEW_DAY_START_HOUR) * (60 / SLOT_MINUTES);
const SLOT_HEIGHT_PX = 24;
const WEEKDAY_SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

/** Match Shadow Chat shell cards */
const shellCard =
  'rounded-[28px] border border-white/90 bg-white/65 shadow-[0_16px_42px_rgba(99,102,241,0.09)] backdrop-blur-md';

const navPillLink =
  'inline-flex items-center gap-1.5 rounded-full border border-white/90 bg-white/80 px-4 py-2 text-sm font-medium text-gray-800 shadow-sm backdrop-blur-sm transition-all hover:border-purple-200/80 hover:bg-white hover:shadow-md focus:outline-none focus:ring-2 focus:ring-purple-400/40';

const COACH_QUICK_ACTIONS: { label: string; text: string }[] = [
  { label: 'Sat', text: 'make it saturday' },
  { label: 'Sun', text: 'make it sunday' },
  { label: 'Mon–Fri', text: 'weekdays only' },
  { label: 'Wknd', text: 'only on weekend' },
  { label: 'Late', text: 'too early i cannot wake up' },
  { label: 'Spread', text: 'spread across multiple days' },
  { label: 'Gap', text: 'more buffer between blocks' },
];

export default function ExecutionPlannerPage() {
  const navigate = useNavigate();
  const { decisionId } = useParams();
  const [searchParams] = useSearchParams();
  const shadowThreadId = searchParams.get('threadId');
  const fromShadow = searchParams.get('from') === 'shadow';
  const [trace, setTrace] = useState<TraceShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AgilityPreview | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<ExecutionTask[]>([]);
  const [unscheduled, setUnscheduled] = useState<ExecutionTask[]>([]);
  /** AI plan blocks selected for targeted coach / chat (multi-select). */
  const [selectedAiEventIds, setSelectedAiEventIds] = useState<string[]>([]);
  const [altSuggestion, setAltSuggestion] = useState<{ start: string; end: string } | null>(null);
  const [calendarWarning, setCalendarWarning] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [scheduleFeedback, setScheduleFeedback] = useState('');
  const [scheduleCoachBusy, setScheduleCoachBusy] = useState(false);
  const [scheduleCoachNote, setScheduleCoachNote] = useState<string | null>(null);
  /** Accumulated scheduler prefs from prior coach runs (merged on each Re-plan). */
  const [coachBaseOptions, setCoachBaseOptions] = useState<PlannerCoachOptions>(() => loadCoachSchedulerOptions());
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [draftPlacement, setDraftPlacement] = useState<{ id: string; start: string; end: string; conflict: boolean } | null>(null);
  const calendarBodyRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    eventId: string;
    mode: 'move' | 'resize';
    x: number;
    y: number;
    start: string;
    end: string;
  } | null>(null);

  useEffect(() => {
    if (!decisionId) {
      setLoading(false);
      setTrace(null);
      setPreview(buildLocalAgilityPreview({ optionName: 'your selected plan' }));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(apiUrl(`/api/traces/${encodeURIComponent(decisionId)}`));
        if (!res.ok) throw new Error(await res.text());
        const t = (await res.json()) as TraceShape;
        if (cancelled) return;
        setTrace(t);
        setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
        const chosenId = t.recommendation?.chosen_option_id ?? '';
        const optionName = t.options?.find((o) => o.option_id === chosenId)?.name || chosenId || 'selected option';
        let resolvedPreview = buildLocalAgilityPreview({
          optionName,
          recommendationReasoning: t.recommendation?.reasoning,
          riskLabels: t.rationality?.detected_biases ?? [],
          nextActions: (t.recommendation?.next_actions ?? []).map((x) => ({ text: x.action, deadline: x.deadline ?? undefined })),
        });
        try {
          if (chosenId) {
            const pRes = await fetch(apiUrl('/api/decision/agility-preview'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ trace_id: t.decision_id, selected_option_id: chosenId }),
            });
            if (pRes.ok) {
              const payload = (await pRes.json()) as { agility_preview?: AgilityPreview };
              if (payload.agility_preview) resolvedPreview = payload.agility_preview;
            }
          }
        } catch {
          // keep local fallback preview
        }
        setPreview(resolvedPreview);
        const fromActions = mapRecommendationActionsToTasks(t.recommendation?.next_actions ?? []);
        const fromPreview = mapPreviewStepsToTasks(resolvedPreview);
        const merged = [...fromActions, ...fromPreview].slice(0, 8);
        setTasks(merged);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load trace');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [decisionId]);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(EXECUTION_PENDING_CALENDAR_FEEDBACK_KEY);
      if (pending?.trim()) {
        setScheduleFeedback(pending.trim());
        sessionStorage.removeItem(EXECUTION_PENDING_CALENDAR_FEEDBACK_KEY);
        setScheduleCoachNote('Loaded feedback from chat — review and tap Re-plan below.');
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const rawEvents = localStorage.getItem(EXECUTION_EVENTS_STORAGE_KEY);
      if (rawEvents) {
        const parsed = JSON.parse(rawEvents) as CalendarEvent[];
        if (Array.isArray(parsed)) setEvents(parsed);
      }
      const rawTasks = localStorage.getItem(EXECUTION_TASKS_STORAGE_KEY);
      if (rawTasks) {
        const parsed = JSON.parse(rawTasks) as ExecutionTask[];
        if (Array.isArray(parsed)) setTasks(parsed);
      }
    } catch {
      // ignore local cache parse failures
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(EXECUTION_EVENTS_STORAGE_KEY, JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem(EXECUTION_TASKS_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const coachConstraintsLine = useMemo(() => {
    const parts: string[] = [];
    if (coachBaseOptions.allowed_weekdays?.length) {
      parts.push(coachBaseOptions.allowed_weekdays.map((i) => WEEKDAY_SHORT[i] ?? '?').join('/'));
    }
    if (coachBaseOptions.max_ai_blocks_per_day > 0) {
      parts.push(`≤${coachBaseOptions.max_ai_blocks_per_day}/day`);
    }
    if (coachBaseOptions.day_start_hour !== SCHEDULER_DAY_START_HOUR) {
      parts.push(`from ${coachBaseOptions.day_start_hour}:00`);
    }
    if (coachBaseOptions.day_end_hour !== SCHEDULER_DAY_END_HOUR) {
      parts.push(`to ${coachBaseOptions.day_end_hour}:00`);
    }
    if (coachBaseOptions.min_gap_minutes > 10) {
      parts.push(`${coachBaseOptions.min_gap_minutes}m gap`);
    }
    return parts.length ? parts.join(' · ') : '';
  }, [coachBaseOptions]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = new Date();
  const visibleWeekCount = useMemo(() => {
    const start = startOfWeek(weekStart, { weekStartsOn: 1 });
    return events.filter((ev) => isSameDay(startOfWeek(parseISO(ev.start), { weekStartsOn: 1 }), start)).length;
  }, [events, weekStart]);
  const positionedEvents = useMemo(() => {
    const totalMin = (VIEW_DAY_END_HOUR - VIEW_DAY_START_HOUR) * 60;
    const windowStart = VIEW_DAY_START_HOUR * 60;
    const windowEnd = VIEW_DAY_END_HOUR * 60;
    return events
      .map((ev) => {
        const s = parseISO(ev.start);
        const e = parseISO(ev.end);
        const dayIdx = days.findIndex((d) => isSameDay(d, s));
        if (dayIdx < 0) return null;
        let startMin = s.getHours() * 60 + s.getMinutes();
        let endMin = e.getHours() * 60 + e.getMinutes();
        if (!isSameDay(s, e)) endMin = VIEW_DAY_END_HOUR * 60;
        if (endMin <= startMin) endMin = Math.min(VIEW_DAY_END_HOUR * 60, startMin + SLOT_MINUTES);
        const clippedStart = Math.max(startMin, windowStart);
        const clippedEnd = Math.min(endMin, windowEnd);
        if (clippedEnd <= clippedStart) return null;
        return {
          ...ev,
          dayIdx,
          topPct: ((clippedStart - windowStart) / totalMin) * 100,
          heightPct: ((Math.max(SLOT_MINUTES, clippedEnd - clippedStart)) / totalMin) * 100,
          startLabel: format(s, 'HH:mm'),
          endLabel: format(e, 'HH:mm'),
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [days, events]);

  const positionedEventsRef = useRef(positionedEvents);
  positionedEventsRef.current = positionedEvents;

  const [marqueeBox, setMarqueeBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const startMarqueeSelect = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest('[data-calendar-event]')) return;
    e.preventDefault();
    const body = calendarBodyRef.current;
    if (!body) return;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const br = body.getBoundingClientRect();
      const x0 = Math.min(startX, ev.clientX) - br.left;
      const y0 = Math.min(startY, ev.clientY) - br.top;
      const x1 = Math.max(startX, ev.clientX) - br.left;
      const y1 = Math.max(startY, ev.clientY) - br.top;
      setMarqueeBox({ left: x0, top: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) });
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setMarqueeBox(null);
      const br = body.getBoundingClientRect();
      const lx = Math.min(startX, ev.clientX);
      const rx = Math.max(startX, ev.clientX);
      const ty = Math.min(startY, ev.clientY);
      const by = Math.max(startY, ev.clientY);
      const pes = positionedEventsRef.current;
      const hits: string[] = [];
      for (const pe of pes) {
        if (pe.source !== 'ai') continue;
        const colW = br.width / 7;
        const leftEdge = br.left + pe.dayIdx * colW;
        const rightEdge = leftEdge + colW;
        const topEdge = br.top + (pe.topPct / 100) * br.height;
        const bottomEdge = br.top + ((pe.topPct + pe.heightPct) / 100) * br.height;
        if (lx < rightEdge && rx > leftEdge && ty < bottomEdge && by > topEdge) hits.push(pe.id);
      }
      setSelectedAiEventIds((prev) => (ev.shiftKey ? [...new Set([...prev, ...hits])] : hits));
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onUploadIcs = async (file: File) => {
    const text = await file.text();
    const parsed = parseIcsToCalendarEvents(text);
    if (parsed.length === 0) {
      setUploadNotice('No valid calendar events found in this .ics file.');
      return;
    }
    // Jump to the week with most imported events (more reliable than first event).
    const weekBuckets = new Map<string, { ws: Date; count: number }>();
    for (const ev of parsed) {
      const ws = startOfWeek(parseISO(ev.start), { weekStartsOn: 1 });
      const key = ws.toISOString();
      const cur = weekBuckets.get(key);
      if (cur) cur.count += 1;
      else weekBuckets.set(key, { ws, count: 1 });
    }
    const topWeek = [...weekBuckets.values()].sort((a, b) => b.count - a.count)[0];
    if (topWeek) setWeekStart(topWeek.ws);
    setEvents((prev) => [...prev, ...parsed]);
    setUploadNotice(
      `Imported ${parsed.length} event${parsed.length > 1 ? 's' : ''} from ${file.name}. Jumped to week with most events (${topWeek?.count ?? 0}).`,
    );
  };

  const runScheduleCoach = async (feedbackOverride?: string) => {
    const fb = (feedbackOverride ?? scheduleFeedback).trim();
    if (!fb) return;
    if (feedbackOverride !== undefined) setScheduleFeedback(feedbackOverride.trim());
    setScheduleCoachBusy(true);
    setScheduleCoachNote(null);
    const plannerPayload = events.map((x) => ({
      id: x.id,
      title: x.title,
      start: x.start,
      end: x.end,
      source: x.source,
      description: x.description,
      locked: x.locked,
    }));
    const targetTaskIds = selectedAiEventIds
      .map((id) => taskIdFromAiCalendarEventId(id))
      .filter((x): x is string => Boolean(x));
    const targetsArg = targetTaskIds.length > 0 ? targetTaskIds : undefined;
    try {
      const res = await refineScheduleWithFeedback({
        feedback: fb,
        tasks: tasks.map((x) => ({
          id: x.id,
          title: x.title,
          duration_minutes: x.duration_minutes,
          description: x.description,
          priority: x.priority,
          deadline_hint: x.deadline_hint,
        })),
        plannerEvents: plannerPayload,
        targetTaskIds: targetsArg,
        options: coachBaseOptions,
      });
      mergeRefinedScheduleIntoStorage(res, { targetTaskIds: targetsArg });
      setCoachBaseOptions(normalizePlannerCoachOptions(res.adjusted_options as Record<string, unknown>));
      const scheduled = res.schedule.scheduled_events ?? [];
      const un = res.schedule.unscheduled_tasks ?? [];
      setUnscheduled(un as ExecutionTask[]);
      setEvents((prev) => mergeEventsAfterRefine(prev, scheduled as CalendarEvent[], targetsArg));
      if (res.tasks_input != null) {
        setTasks(res.tasks_input as ExecutionTask[]);
      }
      const warn = res.schedule.warnings?.[0];
      setCalendarWarning(warn ?? null);
      setScheduleCoachNote(
        [res.interpretation, scheduled.length ? `${scheduled.length} placed` : '', warn].filter(Boolean).join(' · '),
      );
    } catch (e) {
      setScheduleCoachNote(e instanceof Error ? e.message : 'Could not refine schedule');
    } finally {
      setScheduleCoachBusy(false);
    }
  };

  const runAutoSchedule = () => {
    const visibleWeekStart = setMinutes(setHours(startOfDay(weekStart), SCHEDULER_DAY_START_HOUR), 0);
    void (async () => {
      try {
        const res = await fetch(apiUrl('/api/decision/schedule'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tasks,
            existing_events: events.filter((x) => x.source !== 'ai'),
            options: {
              day_start_hour: coachBaseOptions.day_start_hour,
              day_end_hour: coachBaseOptions.day_end_hour,
              slot_minutes: coachBaseOptions.slot_minutes,
              days: coachBaseOptions.days,
              min_gap_minutes: coachBaseOptions.min_gap_minutes,
              max_ai_blocks_per_day: coachBaseOptions.max_ai_blocks_per_day,
              allowed_weekdays: coachBaseOptions.allowed_weekdays,
            },
          }),
        });
        if (res.ok) {
          const payload = (await res.json()) as {
            scheduled_events?: CalendarEvent[];
            unscheduled_tasks?: ExecutionTask[];
            warnings?: string[];
          };
          const scheduled = payload.scheduled_events ?? [];
          const un = payload.unscheduled_tasks ?? [];
          setUnscheduled(un);
          setEvents((prev) => [...prev.filter((x) => x.source !== 'ai'), ...scheduled]);
          if (scheduled.length > 0) {
            setCalendarWarning(
              `Scheduled ${scheduled.length} task(s) into visible week (${format(weekStart, 'MM/dd')} - ${format(addDays(weekStart, 6), 'MM/dd')}).`,
            );
          } else if (un.length > 0) {
            setCalendarWarning(payload.warnings?.[0] || 'No free slots found in the visible week.');
          }
          return;
        }
      } catch {
        // fallback below
      }
      const { scheduled, unscheduled: un } = scheduleTasksIntoFreeSlots(tasks, events, {
        dayStartHour: SCHEDULER_DAY_START_HOUR,
        dayEndHour: SCHEDULER_DAY_END_HOUR,
        slotMinutes: SLOT_MINUTES,
        startDate: visibleWeekStart,
        days: 7,
      });
      setUnscheduled(un);
      setEvents((prev) => [...prev.filter((x) => x.source !== 'ai'), ...scheduled]);
      if (scheduled.length > 0) {
        setCalendarWarning(`Scheduled ${scheduled.length} task(s) into visible week (${format(weekStart, 'MM/dd')} - ${format(addDays(weekStart, 6), 'MM/dd')}).`);
      } else if (un.length > 0) {
        setCalendarWarning('No free slots found in the visible week. Try another week or fewer tasks.');
      }
    })();
  };

  const selectedAiEvents = useMemo(
    () => events.filter((e) => e.source === 'ai' && selectedAiEventIds.includes(e.id)),
    [events, selectedAiEventIds],
  );
  const selectedEvent = selectedAiEvents.length === 1 ? selectedAiEvents[0] : null;

  const openChatWithSelection = () => {
    const ids = selectedAiEventIds.map((id) => taskIdFromAiCalendarEventId(id)).filter((x): x is string => Boolean(x));
    if (ids.length === 0) return;
    const titles = selectedAiEventIds.map((id) => events.find((ev) => ev.id === id)?.title ?? '').filter(Boolean);
    saveSelectedBlocksContext(ids, titles);
    const tid = shadowThreadId?.trim();
    navigate(tid ? `/chat?thread=${encodeURIComponent(tid)}` : '/chat');
  };

  const requestAltSlot = () => {
    if (!selectedEvent) return;
    setAltSuggestion(
      suggestAlternativeSlot(selectedEvent, events, {
        dayStartHour: SCHEDULER_DAY_START_HOUR,
        dayEndHour: SCHEDULER_DAY_END_HOUR,
        slotMinutes: SLOT_MINUTES,
        days: 7,
      }),
    );
  };

  const acceptAltSlot = () => {
    if (!selectedEvent || !altSuggestion) return;
    const next = { ...selectedEvent, start: altSuggestion.start, end: altSuggestion.end };
    if (hasConflict(parseISO(next.start), parseISO(next.end), events, selectedEvent.id)) return;
    setEvents((prev) => prev.map((x) => (x.id === selectedEvent.id ? next : x)));
    setAltSuggestion(null);
  };

  const exportAiIcs = () => {
    const ai = events.filter((x) => x.source === 'ai');
    const ics = exportEventsToIcs(ai);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `foresight-execution-${decisionId || 'plan'}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clampToCalendar = (candidateStart: Date, durationMinutes: number, dayIdx: number): { start: Date; end: Date } | null => {
    if (dayIdx < 0 || dayIdx >= days.length) return null;
    const day = days[dayIdx];
    const floor = setMinutes(setHours(startOfDay(day), SCHEDULER_DAY_START_HOUR), 0);
    const ceil = setMinutes(setHours(startOfDay(day), SCHEDULER_DAY_END_HOUR), 0);
    let s = candidateStart;
    let e = addMinutes(s, durationMinutes);
    if (s < floor) {
      s = floor;
      e = addMinutes(s, durationMinutes);
    }
    if (e > ceil) {
      e = ceil;
      s = addMinutes(e, -durationMinutes);
    }
    if (s < floor || e > ceil || s >= e) return null;
    return { start: s, end: e };
  };

  useEffect(() => {
    const onMouseMove = (ev: MouseEvent) => {
      const ds = dragStateRef.current;
      const body = calendarBodyRef.current;
      if (!ds || !body) return;
      const rect = body.getBoundingClientRect();
      const dayWidth = rect.width / 7;
      const dx = ev.clientX - ds.x;
      const dy = ev.clientY - ds.y;
      const dayDelta = Math.round(dx / dayWidth);
      const slotDelta = Math.round(dy / SLOT_HEIGHT_PX);
      const originStart = parseISO(ds.start);
      const originEnd = parseISO(ds.end);
      const currentDayIdx = days.findIndex((d) => isSameDay(d, originStart));
      const targetDayIdx = currentDayIdx + dayDelta;
      if (targetDayIdx < 0 || targetDayIdx >= 7) return;

      if (ds.mode === 'move') {
        const duration = Math.max(SLOT_MINUTES, differenceInMinutes(originEnd, originStart));
        const candidateStart = addMinutes(addDays(originStart, dayDelta), slotDelta * SLOT_MINUTES);
        const clamped = clampToCalendar(candidateStart, duration, targetDayIdx);
        if (!clamped) return;
        const conflict = hasConflict(clamped.start, clamped.end, events, ds.eventId);
        setDraftPlacement({
          id: ds.eventId,
          start: clamped.start.toISOString(),
          end: clamped.end.toISOString(),
          conflict,
        });
      } else {
        const baseDuration = Math.max(SLOT_MINUTES, differenceInMinutes(originEnd, originStart));
        const nextDuration = Math.max(SLOT_MINUTES, baseDuration + slotDelta * SLOT_MINUTES);
        const clamped = clampToCalendar(originStart, nextDuration, currentDayIdx);
        if (!clamped) return;
        const conflict = hasConflict(clamped.start, clamped.end, events, ds.eventId);
        setDraftPlacement({
          id: ds.eventId,
          start: clamped.start.toISOString(),
          end: clamped.end.toISOString(),
          conflict,
        });
      }
    };

    const onMouseUp = () => {
      const ds = dragStateRef.current;
      if (!ds) return;
      if (draftPlacement && draftPlacement.id === ds.eventId) {
        if (draftPlacement.conflict) {
          setCalendarWarning('Cannot place task there due to conflict with existing events.');
        } else {
          setEvents((prev) =>
            prev.map((x) =>
              x.id === ds.eventId
                ? {
                    ...x,
                    start: draftPlacement.start,
                    end: draftPlacement.end,
                  }
                : x,
            ),
          );
          setCalendarWarning(null);
        }
      }
      dragStateRef.current = null;
      setDraftPlacement(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [days, draftPlacement, events]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-4 py-6">
        <div className="mx-auto max-w-[1500px]">
          <MainNavButtons />
          <p className="mt-6 text-gray-600">Loading calendar…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-4 py-6">
        <div className="mx-auto max-w-[1500px]">
          <MainNavButtons />
          <p className="mt-6 text-red-700">Failed: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-4 py-6">
      <div className="mx-auto max-w-[1500px]">
        <MainNavButtons />
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/25">
              <CalendarDays className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-3xl text-gray-900" style={{ fontWeight: 700 }}>
                Execution Calendar
              </h1>
              <p className="text-sm text-gray-500">Drag blocks · ⌘/Ctrl multi-select · empty grid box-select</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Page actions">
            {fromShadow && shadowThreadId ? (
              <>
                <Link to={`/chat?thread=${encodeURIComponent(shadowThreadId)}`} className={navPillLink}>
                  <MessageSquare className="h-4 w-4 text-indigo-600" aria-hidden />
                  Chat
                </Link>
                {decisionId ? (
                  <Link
                    to={`/chat?thread=${encodeURIComponent(shadowThreadId)}&openReport=${encodeURIComponent(decisionId)}`}
                    className={navPillLink}
                  >
                    <Sparkles className="h-4 w-4 text-violet-600" aria-hidden />
                    Report
                  </Link>
                ) : null}
              </>
            ) : null}
            {trace?.decision_id ? (
              <Link to={`/trace/${trace.decision_id}`} className={navPillLink}>
                <CalendarDays className="h-4 w-4 text-purple-600" aria-hidden />
                Trace
              </Link>
            ) : (
              <Link to="/" className={navPillLink}>
                <Home className="h-4 w-4 text-purple-600" aria-hidden />
                Home
              </Link>
            )}
          </nav>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_minmax(260px,300px)] xl:items-start">
          <div className="min-w-0 space-y-0">
            <div className={`overflow-hidden ${shellCard} p-3 sm:p-4`}>
              <div className="flex flex-wrap items-center gap-2 border-b border-indigo-100/50 pb-3">
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-white/90 bg-white/90 p-2 text-indigo-700 shadow-sm backdrop-blur-sm hover:border-purple-200 hover:bg-white"
                  onClick={() => setWeekStart((w) => addDays(w, -7))}
                  aria-label="Previous week"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-full border border-white/90 bg-white/90 px-4 py-2 text-xs font-semibold text-indigo-900 shadow-sm backdrop-blur-sm hover:border-purple-200 hover:bg-white"
                  onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
                >
                  Today
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-white/90 bg-white/90 p-2 text-indigo-700 shadow-sm backdrop-blur-sm hover:border-purple-200 hover:bg-white"
                  onClick={() => setWeekStart((w) => addDays(w, 7))}
                  aria-label="Next week"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span className="text-xs tabular-nums text-gray-600">
                  {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d')}
                </span>
                <span className="rounded-full bg-violet-100/80 px-2 py-0.5 text-[11px] font-medium text-violet-900">
                  {visibleWeekCount}
                </span>
              </div>

              <div className="overflow-x-auto pt-3">
                <div className="min-w-[980px]">
                  <div
                    className="mb-1 grid overflow-hidden rounded-2xl border border-indigo-100/60 bg-gradient-to-b from-white/90 to-violet-50/40"
                    style={{ gridTemplateColumns: '56px repeat(7, minmax(0,1fr))' }}
                  >
                    <div />
                    {days.map((d) => (
                      <div
                        key={d.toISOString()}
                        className={`px-1.5 py-1.5 text-center text-[11px] font-semibold ${
                          isSameDay(d, today)
                            ? 'bg-violet-200/50 text-violet-950'
                            : 'text-gray-700'
                        }`}
                      >
                        <span className={`block text-[9px] font-medium uppercase tracking-wide ${isSameDay(d, today) ? 'text-violet-800' : 'text-gray-500'}`}>
                          {format(d, 'EEE')}
                        </span>
                        <span className="text-xs tabular-nums">{format(d, 'd')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: '56px 1fr' }}>
                    <div
                      className="relative rounded-l-2xl border-y border-l border-indigo-100/50 bg-gradient-to-b from-white/70 to-violet-50/30"
                      style={{ height: `${SLOT_COUNT * SLOT_HEIGHT_PX}px` }}
                    >
                      {Array.from({ length: SLOT_COUNT + 1 }, (_, idx) => {
                        const minutes = idx * SLOT_MINUTES;
                        const hour = VIEW_DAY_START_HOUR + Math.floor(minutes / 60);
                        const minute = minutes % 60;
                        const showLabel = minute === 0;
                        return (
                          <div
                            key={`tick-${idx}`}
                            className={`absolute left-0 right-0 pl-1 text-[9px] tabular-nums ${showLabel ? 'text-gray-400' : 'text-transparent select-none'}`}
                            style={{ top: `${idx * SLOT_HEIGHT_PX - 6}px` }}
                          >
                            {`${String(hour).padStart(2, '0')}:00`}
                          </div>
                        );
                      })}
                    </div>
                    <div ref={calendarBodyRef} className="relative rounded-r-2xl border border-indigo-100/50 bg-white/50">
                      {marqueeBox && marqueeBox.width > 2 && marqueeBox.height > 2 ? (
                        <div
                          className="pointer-events-none absolute z-[25] rounded-md border-2 border-violet-500/80 bg-violet-400/20"
                          style={{
                            left: marqueeBox.left,
                            top: marqueeBox.top,
                            width: marqueeBox.width,
                            height: marqueeBox.height,
                          }}
                          aria-hidden
                        />
                      ) : null}
                      <div
                        className="grid overflow-hidden rounded-r-2xl"
                        style={{ gridTemplateColumns: 'repeat(7, minmax(0,1fr))' }}
                      >
                      {days.map((day, dayIdx) => (
                        <div
                          key={`day-col-${day.toISOString()}`}
                          role="presentation"
                          onMouseDown={startMarqueeSelect}
                          className={`relative border-l border-indigo-100/40 first:border-l-0 ${
                            isSameDay(day, today) ? 'bg-violet-50/45' : 'bg-white/40'
                          }`}
                          style={{
                            height: `${SLOT_COUNT * SLOT_HEIGHT_PX}px`,
                            backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${SLOT_HEIGHT_PX - 1}px, rgba(196,181,253,0.35) ${SLOT_HEIGHT_PX - 1}px, rgba(196,181,253,0.35) ${SLOT_HEIGHT_PX}px)`,
                          }}
                        >
                          {positionedEvents
                            .filter((ev) => ev.dayIdx === dayIdx)
                            .map((ev) => {
                              const isSelected = selectedAiEventIds.includes(ev.id);
                              const source = ev.source;
                              return (
                                <div
                                  key={ev.id}
                                  data-calendar-event={source === 'ai' ? 'ai' : 'busy'}
                                  onMouseDown={(event) => {
                                    if (source !== 'ai') return;
                                    event.stopPropagation();
                                    dragStateRef.current = {
                                      eventId: ev.id,
                                      mode: 'move',
                                      x: event.clientX,
                                      y: event.clientY,
                                      start: ev.start,
                                      end: ev.end,
                                    };
                                    setCalendarWarning(null);
                                  }}
                                  onClick={(event) => {
                                    if (source !== 'ai') {
                                      setSelectedAiEventIds([]);
                                      return;
                                    }
                                    event.stopPropagation();
                                    if (event.metaKey || event.ctrlKey) {
                                      setSelectedAiEventIds((prev) =>
                                        prev.includes(ev.id) ? prev.filter((id) => id !== ev.id) : [...prev, ev.id],
                                      );
                                    } else {
                                      setSelectedAiEventIds([ev.id]);
                                    }
                                  }}
                                  title={`${ev.title}\n${ev.startLabel}–${ev.endLabel}`}
                                  className={`absolute left-0.5 right-0.5 z-30 overflow-hidden rounded-lg border px-1 py-0.5 text-left leading-tight shadow-sm ${
                                    source === 'uploaded'
                                      ? 'border-purple-200/80 bg-white/90 text-gray-800 backdrop-blur-sm'
                                      : isSelected
                                        ? 'cursor-grab border-violet-700 bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20'
                                        : 'cursor-grab border-indigo-400/60 bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-indigo-500/15'
                                  }`}
                                  style={{ top: `${ev.topPct}%`, height: `${Math.max(4, ev.heightPct)}%` }}
                                >
                                  <div className="truncate text-[10px] font-semibold">{ev.title}</div>
                                  {source === 'ai' && (
                                    <div
                                      onMouseDown={(event) => {
                                        event.stopPropagation();
                                        dragStateRef.current = {
                                          eventId: ev.id,
                                          mode: 'resize',
                                          x: event.clientX,
                                          y: event.clientY,
                                          start: ev.start,
                                          end: ev.end,
                                        };
                                        setCalendarWarning(null);
                                      }}
                                      className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize bg-white/30"
                                      title="Drag to resize duration"
                                    />
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside className="min-w-0 space-y-4 xl:sticky xl:top-6 xl:self-start">
            {preview ? (
              <div className={shellCard}>
                <AgilityPreviewCard preview={preview} variant="sidebar" />
              </div>
            ) : null}

            <section className={`${shellCard} space-y-3 p-4`}>
              <div className="flex flex-wrap items-center gap-2">
                <CalendarUpload onUpload={onUploadIcs} uploadedCount={events.filter((x) => x.source === 'uploaded').length} />
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:from-indigo-500 hover:to-violet-500"
                  onClick={runAutoSchedule}
                >
                  <Sparkles className="h-3.5 w-3.5 opacity-90" aria-hidden />
                  Plan
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-indigo-200/90 bg-white/80 px-3 py-1.5 text-xs font-medium text-indigo-900 hover:bg-white"
                  onClick={exportAiIcs}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  .ics
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-indigo-200/90 bg-white/80 px-3 py-1.5 text-xs font-medium text-indigo-900 hover:bg-white"
                  onClick={() => {
                    localStorage.removeItem(EXECUTION_EVENTS_STORAGE_KEY);
                    localStorage.removeItem(EXECUTION_TASKS_STORAGE_KEY);
                    localStorage.removeItem(EXECUTION_SCHEDULE_COACH_OPTIONS_KEY);
                    setCoachBaseOptions(loadCoachSchedulerOptions());
                    setEvents([]);
                    setTasks([]);
                    setUnscheduled([]);
                    setSelectedAiEventIds([]);
                    setAltSuggestion(null);
                    setCalendarWarning(null);
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Reset
                </button>
              </div>

              <div className="border-t border-indigo-100/60 pt-3">
                <div className="flex items-center gap-2 text-indigo-900">
                  <Sparkles className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
                  <span className="text-xs font-semibold uppercase tracking-wide">Schedule coach</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {COACH_QUICK_ACTIONS.map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      disabled={scheduleCoachBusy || tasks.length === 0}
                      onClick={() => void runScheduleCoach(q.text)}
                      className="rounded-full border border-indigo-200/80 bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-indigo-900 hover:bg-white disabled:opacity-40"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
                {coachConstraintsLine ? (
                  <p className="mt-2 line-clamp-2 text-[11px] text-gray-600" title={coachConstraintsLine}>
                    {coachConstraintsLine}
                  </p>
                ) : null}
                <textarea
                  value={scheduleFeedback}
                  onChange={(e) => setScheduleFeedback(e.target.value)}
                  rows={2}
                  placeholder={selectedAiEventIds.length ? `${selectedAiEventIds.length} selected · describe…` : 'Describe changes…'}
                  className="mt-2 w-full resize-none rounded-2xl border border-indigo-100/90 bg-white/90 px-3 py-2 text-xs text-gray-800 placeholder:text-gray-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-purple-400/30"
                />
                <button
                  type="button"
                  disabled={scheduleCoachBusy || !scheduleFeedback.trim() || tasks.length === 0}
                  onClick={() => void runScheduleCoach()}
                  className="mt-2 w-full rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 py-2 text-xs font-semibold text-white shadow-sm hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40"
                >
                  {scheduleCoachBusy ? 'Applying…' : 'Apply'}
                </button>
                {tasks.length === 0 ? <p className="mt-2 text-[11px] text-amber-800">Add tasks to use the coach.</p> : null}
                {scheduleCoachNote ? (
                  <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-gray-600">{scheduleCoachNote}</p>
                ) : null}
              </div>

              {unscheduled.length > 0 && (
                <p className="line-clamp-2 text-[11px] text-amber-800" title={unscheduled.map((x) => x.title).join(', ')}>
                  Open: {unscheduled.map((x) => x.title).join(', ')}
                </p>
              )}
              {uploadNotice && <p className="text-[11px] text-emerald-800">{uploadNotice}</p>}
              {visibleWeekCount === 0 && events.length > 0 && (
                <p className="text-[11px] text-amber-800">No events this week — use arrows.</p>
              )}
              {calendarWarning && <p className="text-[11px] text-rose-700">{calendarWarning}</p>}
            </section>

            {selectedAiEvents.length > 0 && (
              <section className={`${shellCard} space-y-2 p-4`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">
                    {selectedAiEvents.length} selected
                  </p>
                  <button
                    type="button"
                    className="shrink-0 rounded-full border border-indigo-200/90 bg-white/90 p-1 text-gray-500 hover:bg-white"
                    onClick={() => setSelectedAiEventIds([])}
                  >
                    ✕
                  </button>
                </div>
                <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs text-gray-800">
                  {selectedAiEvents.map((ev) => (
                    <li key={ev.id} className="truncate font-medium" title={ev.title}>
                      {ev.title}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={selectedAiEventIds.every((id) => !taskIdFromAiCalendarEventId(id))}
                  onClick={openChatWithSelection}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-indigo-200/90 bg-white/90 py-2 text-xs font-semibold text-indigo-900 hover:bg-white disabled:opacity-40"
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
                  Chat
                </button>
                {selectedEvent ? (
                <div className="flex flex-wrap gap-2 border-t border-indigo-100/60 pt-3">
                  <button
                    type="button"
                    className="rounded-full border border-indigo-200/90 bg-white/90 px-3 py-1.5 text-xs font-medium text-indigo-900 hover:bg-white"
                    onClick={requestAltSlot}
                  >
                    Other slot
                  </button>
                  {altSuggestion && (
                    <>
                      <button
                        type="button"
                        className="rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:from-indigo-500 hover:to-violet-500"
                        onClick={acceptAltSlot}
                      >
                        {format(parseISO(altSuggestion.start), 'EEE HH:mm')}
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-indigo-200/90 bg-white/90 px-3 py-1.5 text-xs text-gray-600 hover:bg-white"
                        onClick={() => setAltSuggestion(null)}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
                ) : null}
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
