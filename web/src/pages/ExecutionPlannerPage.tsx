import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
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
const EVENTS_STORAGE_KEY = 'fx.execution.events.v1';
const TASKS_STORAGE_KEY = 'fx.execution.tasks.v1';

export default function ExecutionPlannerPage() {
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
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [altSuggestion, setAltSuggestion] = useState<{ start: string; end: string } | null>(null);
  const [calendarWarning, setCalendarWarning] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
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
      const rawEvents = localStorage.getItem(EVENTS_STORAGE_KEY);
      if (rawEvents) {
        const parsed = JSON.parse(rawEvents) as CalendarEvent[];
        if (Array.isArray(parsed)) setEvents(parsed);
      }
      const rawTasks = localStorage.getItem(TASKS_STORAGE_KEY);
      if (rawTasks) {
        const parsed = JSON.parse(rawTasks) as ExecutionTask[];
        if (Array.isArray(parsed)) setTasks(parsed);
      }
    } catch {
      // ignore local cache parse failures
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = new Date();
  const visibleWeekCount = useMemo(() => {
    const start = startOfWeek(weekStart, { weekStartsOn: 1 });
    return events.filter((ev) => isSameDay(startOfWeek(parseISO(ev.start), { weekStartsOn: 1 }), start)).length;
  }, [events, weekStart]);
  const uploadedPreview = useMemo(
    () =>
      events
        .filter((x) => x.source === 'uploaded')
        .slice(0, 6)
        .map((x) => `${x.title} | ${x.start} -> ${x.end}`),
    [events],
  );
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

  const runAutoSchedule = () => {
    const visibleWeekStart = setMinutes(setHours(startOfDay(weekStart), SCHEDULER_DAY_START_HOUR), 0);
    void (async () => {
      try {
        const res = await fetch(apiUrl('/api/decision/schedule'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tasks,
            existing_events: events,
            options: {
              day_start_hour: SCHEDULER_DAY_START_HOUR,
              day_end_hour: SCHEDULER_DAY_END_HOUR,
              slot_minutes: SLOT_MINUTES,
              days: 7,
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

  const selectedEvent = events.find((x) => x.id === selectedEventId && x.source === 'ai') || null;

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

  if (loading) return <div className="p-6">Loading execution planner…</div>;
  if (error) return <div className="p-6 text-red-700">Failed: {error}</div>;

  return (
    <div className="min-h-screen bg-[#eef2f6]">
      <div className="max-w-[1600px] mx-auto px-4 pb-8 sm:px-6">
        <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#eef2f6]/90 pt-4 pb-3 backdrop-blur-md">
          <div className="rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm sm:px-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <MainNavButtons variant="compact" />
                <div className="hidden h-8 w-px shrink-0 bg-slate-200 sm:block" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-indigo-600">Agility · weekly</p>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0">
                    <h1 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">Execution calendar</h1>
                    <span className="hidden text-xs text-slate-500 md:inline">Drag AI blocks to reschedule</span>
                  </div>
                </div>
              </div>
              <nav className="flex shrink-0 flex-wrap items-center justify-start gap-2 sm:justify-end" aria-label="Page actions">
                {fromShadow && shadowThreadId ? (
                  <>
                    <Link
                      to={`/chat?thread=${encodeURIComponent(shadowThreadId)}`}
                      className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-900 hover:bg-indigo-100"
                    >
                      Shadow chat
                    </Link>
                    {decisionId ? (
                      <Link
                        to={`/chat?thread=${encodeURIComponent(shadowThreadId)}&openReport=${encodeURIComponent(decisionId)}`}
                        className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-900 hover:bg-violet-100"
                      >
                        Report
                      </Link>
                    ) : null}
                  </>
                ) : null}
                {trace?.decision_id ? (
                  <Link
                    to={`/trace/${trace.decision_id}`}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white"
                  >
                    Full trace
                  </Link>
                ) : (
                  <Link
                    to="/"
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white"
                  >
                    Home
                  </Link>
                )}
              </nav>
            </div>
          </div>
        </header>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_minmax(280px,340px)] xl:items-start">
          <div className="min-w-0 space-y-0">
            <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/80 px-3 py-3 sm:px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => setWeekStart((w) => addDays(w, -7))}
                  >
                    ← Prev
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-900 hover:bg-indigo-100"
                    onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
                  >
                    This week
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => setWeekStart((w) => addDays(w, 7))}
                  >
                    Next →
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                  <span className="font-medium text-slate-800">
                    {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
                  </span>
                  <span className="rounded-full bg-teal-50 px-2.5 py-0.5 font-medium text-teal-800">{visibleWeekCount} events</span>
                  <span className="hidden items-center gap-3 sm:inline-flex">
                    <span className="inline-flex items-center gap-1.5 text-slate-600">
                      <span className="h-2 w-2 rounded-sm bg-slate-300" aria-hidden />
                      Uploaded
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-slate-600">
                      <span className="h-2 w-2 rounded-sm bg-indigo-500" aria-hidden />
                      AI plan
                    </span>
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto p-3 sm:p-4">
                <div className="min-w-[980px]">
                  <div
                    className="grid mb-2 rounded-lg border border-slate-200 bg-slate-50"
                    style={{ gridTemplateColumns: '80px repeat(7, minmax(0,1fr))' }}
                  >
                    <div />
                    {days.map((d) => (
                      <div
                        key={d.toISOString()}
                        className={`px-2 py-2 text-center text-xs font-semibold ${
                          isSameDay(d, today) ? 'bg-indigo-100 text-indigo-900' : 'text-slate-700'
                        }`}
                      >
                        <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">{format(d, 'EEE')}</span>
                        <span className="text-sm tabular-nums">{format(d, 'd')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: '80px 1fr' }}>
                    <div
                      className="relative rounded-l-lg border-y border-l border-slate-200 bg-slate-50"
                      style={{ height: `${SLOT_COUNT * SLOT_HEIGHT_PX}px` }}
                    >
                      {Array.from({ length: SLOT_COUNT + 1 }, (_, idx) => {
                        const minutes = idx * SLOT_MINUTES;
                        const hour = VIEW_DAY_START_HOUR + Math.floor(minutes / 60);
                        const minute = minutes % 60;
                        return (
                          <div
                            key={`tick-${idx}`}
                            className="absolute left-0 right-0 pl-2 text-[11px] tabular-nums text-slate-400"
                            style={{ top: `${idx * SLOT_HEIGHT_PX - 8}px` }}
                          >
                            {`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`}
                          </div>
                        );
                      })}
                    </div>
                    <div
                      ref={calendarBodyRef}
                      className="grid rounded-r-lg border border-slate-200 overflow-hidden"
                      style={{ gridTemplateColumns: 'repeat(7, minmax(0,1fr))' }}
                    >
                      {days.map((day, dayIdx) => (
                        <div
                          key={`day-col-${day.toISOString()}`}
                          className={`relative border-l border-slate-100 first:border-l-0 ${
                            isSameDay(day, today) ? 'bg-indigo-50/40' : 'bg-white'
                          }`}
                          style={{
                            height: `${SLOT_COUNT * SLOT_HEIGHT_PX}px`,
                            backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${SLOT_HEIGHT_PX - 1}px, #e2e8f0 ${SLOT_HEIGHT_PX - 1}px, #e2e8f0 ${SLOT_HEIGHT_PX}px)`,
                          }}
                        >
                          {positionedEvents
                            .filter((ev) => ev.dayIdx === dayIdx)
                            .map((ev) => {
                              const isSelected = selectedEventId === ev.id;
                              const source = ev.source;
                              return (
                                <div
                                  key={ev.id}
                                  onMouseDown={(event) => {
                                    if (source !== 'ai') return;
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
                                  onClick={() => setSelectedEventId(ev.id)}
                                  className={`absolute left-1 right-1 z-30 overflow-hidden rounded-md border px-2 py-1 text-left text-[11px] ${
                                    source === 'uploaded'
                                      ? 'border-slate-300 bg-slate-200/90 text-slate-800'
                                      : isSelected
                                        ? 'cursor-grab border-indigo-800 bg-indigo-700 text-white shadow-md'
                                        : 'cursor-grab border-indigo-600 bg-indigo-500 text-white shadow-sm'
                                  }`}
                                  style={{ top: `${ev.topPct}%`, height: `${Math.max(4, ev.heightPct)}%` }}
                                >
                                  <div className="truncate font-semibold">{ev.title}</div>
                                  <div className="opacity-90">
                                    {ev.startLabel} – {ev.endLabel}
                                  </div>
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

          <aside className="min-w-0 space-y-3 xl:sticky xl:top-[5.5rem] xl:self-start">
            <AgilityPreviewCard preview={preview} variant="sidebar" />

            <section className="space-y-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-slate-500">Planner</p>
              <div className="flex flex-wrap gap-2">
                <CalendarUpload onUpload={onUploadIcs} uploadedCount={events.filter((x) => x.source === 'uploaded').length} />
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {events.filter((x) => x.source === 'uploaded').length} uploaded
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                  onClick={runAutoSchedule}
                >
                  Create plan
                </button>
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onClick={exportAiIcs}
                >
                  Export .ics
                </button>
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    localStorage.removeItem(EVENTS_STORAGE_KEY);
                    localStorage.removeItem(TASKS_STORAGE_KEY);
                    setEvents([]);
                    setTasks([]);
                    setUnscheduled([]);
                    setSelectedEventId(null);
                    setAltSuggestion(null);
                    setCalendarWarning(null);
                  }}
                >
                  Clear
                </button>
              </div>
              <p className="text-[11px] text-slate-400">Google Calendar sync — coming soon</p>

              {unscheduled.length > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  <span className="font-medium">Unscheduled:</span> {unscheduled.map((x) => x.title).join(', ')}
                </p>
              )}
              {uploadNotice && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{uploadNotice}</p>
              )}
              {visibleWeekCount === 0 && events.length > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  No events this week — use prev/next week.
                </p>
              )}
              {uploadedPreview.length > 0 && (
                <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Import preview</p>
                  <ul className="space-y-0.5 text-[11px] text-slate-600">
                    {uploadedPreview.map((line) => (
                      <li key={line} className="truncate">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {calendarWarning && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">{calendarWarning}</p>
              )}
            </section>

            {selectedEvent && (
              <section className="space-y-2 rounded-xl border border-indigo-200/80 bg-indigo-50/50 p-4 shadow-sm">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-indigo-700">Selected block</p>
                <p className="text-sm font-medium text-slate-900">{selectedEvent.title}</p>
                <p className="text-xs tabular-nums text-slate-600">
                  {selectedEvent.start} → {selectedEvent.end}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={requestAltSlot}
                  >
                    Other time
                  </button>
                  {altSuggestion && (
                    <>
                      <button
                        type="button"
                        className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                        onClick={acceptAltSlot}
                      >
                        Use {format(parseISO(altSuggestion.start), 'EEE HH:mm')}
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() => setAltSuggestion(null)}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
