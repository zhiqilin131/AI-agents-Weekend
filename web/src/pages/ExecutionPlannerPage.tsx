import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { addDays, addMinutes, differenceInMinutes, format, isSameDay, parseISO, setHours, setMinutes, startOfDay, startOfWeek } from 'date-fns';
import { apiUrl } from '../utils/apiOrigin';
import { MainNavButtons } from '../app/components/MainNavButtons';
import { buildLocalAgilityPreview, mapPreviewStepsToTasks, type AgilityPreview } from '../utils/agilityPreview';
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
            const pRes = await fetch(apiUrl('/api/agility-preview'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ decision_id: t.decision_id, selected_option_id: chosenId }),
            });
            if (pRes.ok) {
              resolvedPreview = (await pRes.json()) as AgilityPreview;
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
    <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff]">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-4">
        <MainNavButtons />
        <div className="flex items-center justify-between rounded-[24px] border border-white/90 bg-white/70 p-5 shadow-[0_8px_40px_rgba(0,0,0,0.05)] backdrop-blur-md">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Agility / Execution Calendar</h1>
            <p className="text-sm text-gray-500 mt-1">Plan, schedule, and adjust execution blocks anytime.</p>
          </div>
          {trace?.decision_id ? (
            <Link to={`/trace/${trace.decision_id}`} className="text-sm text-indigo-700 hover:underline">
              Back to decision report
            </Link>
          ) : (
            <Link to="/" className="text-sm text-indigo-700 hover:underline">
              Back to home
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            className="px-3 py-1.5 rounded-full border border-gray-200 bg-white/80"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
          >
            Previous week
          </button>
          <button
            className="px-3 py-1.5 rounded-full border border-gray-200 bg-white/80"
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
          >
            This week
          </button>
          <button
            className="px-3 py-1.5 rounded-full border border-gray-200 bg-white/80"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
          >
            Next week
          </button>
          <span className="text-gray-600 ml-1">
            Showing {format(weekStart, 'MMM dd')} - {format(addDays(weekStart, 6), 'MMM dd')}
          </span>
          <span className="text-gray-500 ml-2">Events this week: {visibleWeekCount}</span>
        </div>
      </div>

      {preview && (
        <section className="max-w-[1400px] mx-auto rounded-[24px] border border-white/90 bg-gradient-to-br from-white/80 to-purple-50/55 p-5 shadow-[0_8px_40px_rgba(0,0,0,0.04)] backdrop-blur-md space-y-2">
          <h2 className="text-sm font-semibold text-indigo-900">Agility Preview</h2>
          <p className="text-sm text-gray-800">{preview.summary}</p>
          <p className="text-sm text-gray-700"><span className="font-semibold">Workload:</span> {preview.workload_impact}</p>
          <p className="text-sm text-gray-700"><span className="font-semibold">Review checkpoint:</span> {preview.review_checkpoint}</p>
          <ul className="list-disc ml-5 text-sm text-gray-700">
            {preview.likely_consequences.slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </section>
      )}

      <section className="max-w-[1400px] mx-auto rounded-[24px] border border-white/90 bg-white/75 p-5 shadow-[0_8px_40px_rgba(0,0,0,0.04)] backdrop-blur-md space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs px-3 py-2 rounded-full border border-indigo-200 cursor-pointer bg-indigo-50 text-indigo-800 hover:bg-indigo-100">
            Upload .ics calendar
            <input
              className="hidden"
              type="file"
              accept=".ics,text/calendar"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onUploadIcs(file);
              }}
            />
          </label>
          <span className="text-xs text-gray-500">
            Uploaded events: {events.filter((x) => x.source === 'uploaded').length}
          </span>
          <button className="text-xs px-3 py-2 rounded-full bg-indigo-600 text-white" onClick={runAutoSchedule}>
            Create execution plan
          </button>
          <button className="text-xs px-3 py-2 rounded-full border border-gray-200" onClick={exportAiIcs}>
            Export AI .ics
          </button>
          <button
            className="text-xs px-3 py-2 rounded-full border border-gray-200"
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
            Clear local planner
          </button>
          <button className="text-xs px-3 py-2 rounded-full border border-gray-200 opacity-70" disabled>
            Sync to Google Calendar (coming soon)
          </button>
        </div>
        {unscheduled.length > 0 && (
          <p className="text-xs text-amber-700">
            Unscheduled tasks: {unscheduled.map((x) => x.title).join(', ')}
          </p>
        )}
        {uploadNotice && <p className="text-xs text-emerald-700">{uploadNotice}</p>}
        {visibleWeekCount === 0 && events.length > 0 && (
          <p className="text-xs text-amber-700">
            No events in currently visible week. Try Previous/Next week.
          </p>
        )}
        {uploadedPreview.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white/70 px-3 py-2">
            <p className="text-[11px] text-gray-600 mb-1">Imported event preview (first 6):</p>
            <ul className="text-[11px] text-gray-700 space-y-0.5">
              {uploadedPreview.map((line) => (
                <li key={line} className="truncate">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
        {calendarWarning && <p className="text-xs text-rose-700">{calendarWarning}</p>}
      </section>

      <section className="max-w-[1400px] mx-auto rounded-[24px] border border-white/90 bg-white/75 p-5 shadow-[0_8px_40px_rgba(0,0,0,0.04)] backdrop-blur-md overflow-x-auto">
        <div className="min-w-[980px]">
          <div className="grid mb-2" style={{ gridTemplateColumns: '80px repeat(7, minmax(0,1fr))' }}>
            <div />
            {days.map((d) => (
              <div key={d.toISOString()} className="text-xs font-semibold text-gray-700 px-2 py-1">
                {format(d, 'EEE MM/dd')}
              </div>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: '80px 1fr' }}>
            <div className="relative" style={{ height: `${SLOT_COUNT * SLOT_HEIGHT_PX}px` }}>
              {Array.from({ length: SLOT_COUNT + 1 }, (_, idx) => {
                const minutes = idx * SLOT_MINUTES;
                const hour = VIEW_DAY_START_HOUR + Math.floor(minutes / 60);
                const minute = minutes % 60;
                return (
                  <div
                    key={`tick-${idx}`}
                    className="absolute left-0 right-0 text-[11px] text-gray-500"
                    style={{ top: `${idx * SLOT_HEIGHT_PX - 8}px` }}
                  >
                    {`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`}
                  </div>
                );
              })}
            </div>
            <div ref={calendarBodyRef} className="grid border border-gray-100 rounded-xl overflow-hidden" style={{ gridTemplateColumns: 'repeat(7, minmax(0,1fr))' }}>
              {days.map((day, dayIdx) => (
                <div
                  key={`day-col-${day.toISOString()}`}
                  className="relative border-l border-gray-100 first:border-l-0"
                  style={{
                    height: `${SLOT_COUNT * SLOT_HEIGHT_PX}px`,
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${SLOT_HEIGHT_PX - 1}px, #f1f5f9 ${SLOT_HEIGHT_PX - 1}px, #f1f5f9 ${SLOT_HEIGHT_PX}px)`,
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
                          className={`absolute left-1 right-1 text-left rounded-md px-2 py-1 text-[11px] overflow-hidden border z-30 ${
                            source === 'uploaded'
                              ? 'bg-gray-200/95 border-gray-300 text-gray-800'
                              : isSelected
                                ? 'bg-indigo-600 border-indigo-700 text-white cursor-grab'
                                : 'bg-indigo-500/90 border-indigo-600 text-white cursor-grab'
                          }`}
                          style={{ top: `${ev.topPct}%`, height: `${Math.max(4, ev.heightPct)}%` }}
                        >
                          <div className="font-semibold truncate">{ev.title}</div>
                          <div className="opacity-90">{ev.startLabel} - {ev.endLabel}</div>
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
                              className="absolute bottom-0 left-0 right-0 h-2 bg-white/30 cursor-ns-resize"
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
      </section>

      {selectedEvent && (
        <section className="max-w-[1400px] mx-auto rounded-[24px] border border-white/90 bg-white/75 p-5 shadow-[0_8px_40px_rgba(0,0,0,0.04)] backdrop-blur-md space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Selected AI block</h3>
          <p className="text-sm text-gray-700">{selectedEvent.title}</p>
          <p className="text-xs text-gray-600">{selectedEvent.start} → {selectedEvent.end}</p>
          <div className="flex gap-2">
            <button className="text-xs px-3 py-2 rounded-full border border-gray-200" onClick={requestAltSlot}>
              Suggest another time
            </button>
            {altSuggestion && (
              <>
                <button className="text-xs px-3 py-2 rounded-full bg-indigo-600 text-white" onClick={acceptAltSlot}>
                  Accept {format(parseISO(altSuggestion.start), 'EEE HH:mm')}
                </button>
                <button className="text-xs px-3 py-2 rounded-full border border-gray-200" onClick={() => setAltSuggestion(null)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
