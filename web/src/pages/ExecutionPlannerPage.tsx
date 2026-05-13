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
  Trash2,
  X,
} from 'lucide-react';
import { addDays, addMinutes, differenceInMinutes, format, isSameDay, parseISO, setHours, setMinutes, startOfDay, startOfWeek } from 'date-fns';
import { apiFetch } from '../utils/apiFetch';
import { MainNavButtons } from '../app/components/MainNavButtons';
import {
  AgilityPreview as AgilityPreviewSidebar,
  agilityPreviewSidebarHasContent,
  type AgilityPreviewData,
} from '../app/components/AgilityPreview';
import { buildLocalAgilityPreview, mapPreviewStepsToTasks, type AgilityPreview } from '../utils/agilityPreview';
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
  CALENDAR_AGENT_SESSION_DRAFT_KEY,
  EXECUTION_PENDING_CALENDAR_FEEDBACK_KEY,
  executionStorageKeys,
  SLIME_VOICE_CALENDAR_RESOLVED_KEY,
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
import { SLIME_VOICE_CALENDAR_DRAFT_KEY } from '../utils/slimeVoiceActions';
import { SlimeAdvisor } from '../app/components/report/SlimeAdvisor';
import { CalendarAgentPanel } from '../app/components/calendar/CalendarAgentPanel';
import { useSlimeProfile } from '../hooks/useSlimeProfile';
import type { CalendarAgentDraft } from '../utils/calendarAgentApi';
import { useExecutionStorageUserKey } from '../hooks/useExecutionStorageUserKey';

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
/** Shorter rows so more hours fit; outer panel scrolls vertically. */
const SLOT_HEIGHT_PX = 20;
const DETAIL_DRAG_THRESHOLD_PX = 6;
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

function dedupeExecutionTasks(tasks: ExecutionTask[], limit = 8): ExecutionTask[] {
  const seen = new Set<string>();
  const out: ExecutionTask[] = [];
  for (const task of tasks) {
    const key = task.title.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(task);
    if (out.length >= limit) break;
  }
  return out;
}

function dedupeAiEventsByTitle(events: CalendarEvent[]): CalendarEvent[] {
  const seenAiTitles = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const event of events) {
    const key = event.title.trim().toLowerCase().replace(/\s+/g, ' ');
    if (event.source === 'ai' && key) {
      if (seenAiTitles.has(key)) continue;
      seenAiTitles.add(key);
    }
    out.push(event);
  }
  return out;
}

function dedupeEventsForTaskTitles(events: CalendarEvent[], tasks: ExecutionTask[]): CalendarEvent[] {
  const taskTitles = new Set(
    tasks.map((task) => task.title.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean),
  );
  const seenTaskEvents = new Set<string>();
  return events.filter((event) => {
    const key = event.title.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!taskTitles.has(key)) return true;
    if (seenTaskEvents.has(key)) return false;
    seenTaskEvents.add(key);
    return true;
  });
}

export default function ExecutionPlannerPage() {
  const { slimeProfile } = useSlimeProfile();
  const { storageUserKey, ready: storageReady } = useExecutionStorageUserKey();
  const storageKeys = useMemo(
    () => (storageUserKey ? executionStorageKeys(storageUserKey) : null),
    [storageUserKey],
  );
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
  const [coachBaseOptions, setCoachBaseOptions] = useState<PlannerCoachOptions>(() => normalizePlannerCoachOptions({}));
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [draftPlacement, setDraftPlacement] = useState<{ id: string; start: string; end: string; conflict: boolean } | null>(null);
  const [sessionAgentDraft, setSessionAgentDraft] = useState<CalendarAgentDraft | null>(null);
  const calendarBodyRef = useRef<HTMLDivElement | null>(null);
  const pendingPointerRef = useRef<{
    eventId: string;
    clientX: number;
    clientY: number;
    start: string;
    end: string;
  } | null>(null);
  const plannerHydratedRef = useRef(false);
  const serverSyncSkipUntilRef = useRef<number>(0);
  const dragStateRef = useRef<{
    eventId: string;
    mode: 'move' | 'resize';
    x: number;
    y: number;
    start: string;
    end: string;
  } | null>(null);

  const [detailEventId, setDetailEventId] = useState<string | null>(null);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailStartLocal, setDetailStartLocal] = useState('');
  const [detailEndLocal, setDetailEndLocal] = useState('');
  const [detailDescription, setDetailDescription] = useState('');
  const [detailLocked, setDetailLocked] = useState(false);

  const detailEvent = useMemo(() => events.find((e) => e.id === detailEventId) ?? null, [detailEventId, events]);

  useEffect(() => {
    if (!detailEventId) return;
    if (!events.some((e) => e.id === detailEventId)) setDetailEventId(null);
  }, [detailEventId, events]);

  useEffect(() => {
    if (!detailEventId || !detailEvent || detailEvent.id !== detailEventId) return;
    setDetailTitle(detailEvent.title);
    setDetailStartLocal(format(parseISO(detailEvent.start), "yyyy-MM-dd'T'HH:mm"));
    setDetailEndLocal(format(parseISO(detailEvent.end), "yyyy-MM-dd'T'HH:mm"));
    setDetailDescription(detailEvent.description ?? '');
    setDetailLocked(Boolean(detailEvent.locked));
  }, [detailEventId, detailEvent]);

  useEffect(() => {
    if (!storageReady || !storageUserKey) return;
    setCoachBaseOptions(loadCoachSchedulerOptions(storageUserKey));
  }, [storageReady, storageUserKey]);

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
        const res = await apiFetch(`/api/traces/${encodeURIComponent(decisionId)}`);
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
            const pRes = await apiFetch('/api/decision/agility-preview', {
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
        const merged = dedupeExecutionTasks([...fromActions, ...fromPreview], 8);
        setTasks(merged);
        setEvents((prev) => dedupeEventsForTaskTitles(prev, merged));
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
      const raw = sessionStorage.getItem(CALENDAR_AGENT_SESSION_DRAFT_KEY);
      if (raw) {
        sessionStorage.removeItem(CALENDAR_AGENT_SESSION_DRAFT_KEY);
        const parsed = JSON.parse(raw) as { draft?: CalendarAgentDraft };
        if (parsed.draft?.draft_id) {
          setSessionAgentDraft(parsed.draft);
          serverSyncSkipUntilRef.current = Date.now() + 2500;
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

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
    if (!storageReady) return;
    try {
      const raw = sessionStorage.getItem(SLIME_VOICE_CALENDAR_DRAFT_KEY);
      if (!raw) return;
      sessionStorage.removeItem(SLIME_VOICE_CALENDAR_DRAFT_KEY);
      const d = JSON.parse(raw) as {
        title?: string;
        duration_minutes?: number;
        date_hint?: string | null;
        description?: string | null;
      };
      const hint = (d.date_hint || '').toLowerCase();
      const baseDay =
        hint.includes('today') ? new Date() : addDays(new Date(), hint.includes('yesterday') ? -1 : 1);
      const dayStart = startOfDay(baseDay);
      const start = setMinutes(setHours(dayStart, SCHEDULER_DAY_START_HOUR), 0);
      const dur = Math.max(5, Math.min(Number(d.duration_minutes) || 30, 480));
      const end = addMinutes(start, dur);
      setEvents((prev) => [
        ...prev,
        {
          id: `voice-draft-${Date.now()}`,
          title: (d.title || 'Planning block').slice(0, 200),
          start: start.toISOString(),
          end: end.toISOString(),
          source: 'manual',
          description: (d.description || 'Draft from Slime voice').slice(0, 500),
          locked: false,
        },
      ]);
      setScheduleCoachNote('Draft block from Slime voice — adjust time or delete if you do not need it.');
    } catch {
      // ignore
    }
  }, [storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      const raw = sessionStorage.getItem(SLIME_VOICE_CALENDAR_RESOLVED_KEY);
      if (!raw) return;
      sessionStorage.removeItem(SLIME_VOICE_CALENDAR_RESOLVED_KEY);
      const r = JSON.parse(raw) as {
        title?: string;
        start_iso?: string;
        end_iso?: string;
        display_summary?: string;
      };
      const st = r.start_iso;
      const en = r.end_iso;
      if (!st || !en) return;
      const ev: CalendarEvent = {
        id: `voice-resolved-${Date.now()}`,
        title: (r.title || 'Event').slice(0, 200),
        start: st,
        end: en,
        source: 'manual',
        description: (r.display_summary || 'From Slime voice').slice(0, 500),
        locked: false,
      };
      setEvents((prev) => [...prev, ev]);
      setScheduleCoachNote('Loaded times from Slime — drag to adjust if needed.');
    } catch {
      // ignore
    }
  }, [storageReady]);

  useEffect(() => {
    plannerHydratedRef.current = false;
    if (!storageReady || !storageKeys) return;
    try {
      const rawEvents = localStorage.getItem(storageKeys.events);
      if (rawEvents) {
        const parsed = JSON.parse(rawEvents) as CalendarEvent[];
        if (Array.isArray(parsed)) setEvents(dedupeAiEventsByTitle(parsed));
      } else {
        setEvents([]);
      }
      const rawTasks = localStorage.getItem(storageKeys.tasks);
      if (rawTasks) {
        const parsed = JSON.parse(rawTasks) as ExecutionTask[];
        if (Array.isArray(parsed) && parsed.length > 0) setTasks(parsed);
        else if (!decisionId) setTasks([]);
      } else if (!decisionId) {
        setTasks([]);
      }
    } catch {
      // ignore local cache parse failures
    } finally {
      plannerHydratedRef.current = true;
    }
  }, [storageReady, storageKeys]);

  useEffect(() => {
    if (!storageReady || !storageUserKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch('/api/calendar/events');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { events?: Array<Record<string, unknown>> };
        const list = data.events;
        if (!Array.isArray(list) || list.length === 0) return;
        setEvents((prev) => {
          const toPlanner = (raw: Record<string, unknown>): CalendarEvent => {
            const src = raw.source;
            const source: CalendarEvent['source'] =
              src === 'uploaded' ? 'uploaded' : src === 'ai' || src === 'ai_draft' ? 'ai' : 'manual';
            return {
              id: String(raw.id ?? `srv-${Date.now()}`),
              title: String(raw.title ?? ''),
              start: String(raw.start ?? ''),
              end: String(raw.end ?? ''),
              source,
              description: typeof raw.description === 'string' ? raw.description : undefined,
              locked: Boolean(raw.locked),
            };
          };
          if (prev.length === 0) return dedupeAiEventsByTitle(list.map(toPlanner));
          const ids = new Set(prev.map((p) => p.id));
          const merged = [...prev];
          for (const raw of list) {
            const e = toPlanner(raw);
            if (!ids.has(e.id)) merged.push(e);
          }
          return dedupeAiEventsByTitle(merged);
        });
      } catch {
        /* offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageReady, storageUserKey]);

  useEffect(() => {
    if (!storageKeys || !plannerHydratedRef.current) return;
    localStorage.setItem(storageKeys.events, JSON.stringify(events));
  }, [events, storageKeys]);

  useEffect(() => {
    if (Date.now() < serverSyncSkipUntilRef.current) return;
    const t = window.setTimeout(() => {
      const payload = events.map((x) => ({
        id: x.id,
        title: x.title,
        start: x.start,
        end: x.end,
        source: x.source === 'ai' ? 'ai' : x.source === 'uploaded' ? 'uploaded' : 'manual',
        description: x.description ?? '',
        locked: Boolean(x.locked),
        conflict: false,
      }));
      void apiFetch('/api/calendar/events', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: payload }),
      }).catch(() => {
        /* ignore */
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [events]);

  useEffect(() => {
    if (!storageKeys || !plannerHydratedRef.current) return;
    localStorage.setItem(storageKeys.tasks, JSON.stringify(tasks));
  }, [tasks, storageKeys]);

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
        const startIso = draftPlacement?.id === ev.id ? draftPlacement.start : ev.start;
        const endIso = draftPlacement?.id === ev.id ? draftPlacement.end : ev.end;
        const s = parseISO(startIso);
        const e = parseISO(endIso);
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
          start: startIso,
          end: endIso,
          dayIdx,
          topPct: ((clippedStart - windowStart) / totalMin) * 100,
          heightPct: ((Math.max(SLOT_MINUTES, clippedEnd - clippedStart)) / totalMin) * 100,
          startLabel: format(s, 'HH:mm'),
          endLabel: format(e, 'HH:mm'),
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [days, draftPlacement, events]);

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
      if (storageUserKey) mergeRefinedScheduleIntoStorage(storageUserKey, res, { targetTaskIds: targetsArg });
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
        const res = await apiFetch('/api/decision/schedule', {
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
      const pend = pendingPointerRef.current;
      if (pend && !dragStateRef.current) {
        const dx = ev.clientX - pend.clientX;
        const dy = ev.clientY - pend.clientY;
        if (dx * dx + dy * dy >= DETAIL_DRAG_THRESHOLD_PX * DETAIL_DRAG_THRESHOLD_PX) {
          dragStateRef.current = {
            eventId: pend.eventId,
            mode: 'move',
            x: pend.clientX,
            y: pend.clientY,
            start: pend.start,
            end: pend.end,
          };
          pendingPointerRef.current = null;
        } else {
          return;
        }
      }
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
      const pend = pendingPointerRef.current;
      if (pend && !dragStateRef.current) {
        pendingPointerRef.current = null;
        setDetailEventId(pend.eventId);
        if (events.some((e) => e.id === pend.eventId && e.source === 'ai')) {
          setSelectedAiEventIds([pend.eventId]);
        }
        return;
      }
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

  const persistDetailEdits = () => {
    if (!detailEventId) return;
    const startD = new Date(detailStartLocal);
    const endD = new Date(detailEndLocal);
    if (!(startD.getTime() < endD.getTime())) {
      setCalendarWarning('End time must be after start time.');
      return;
    }
    setEvents((prev) =>
      prev.map((x) =>
        x.id === detailEventId
          ? {
              ...x,
              title: detailTitle.slice(0, 200),
              start: startD.toISOString(),
              end: endD.toISOString(),
              description: detailDescription.slice(0, 500),
              locked: detailLocked,
            }
          : x,
      ),
    );
    setCalendarWarning(null);
    setDetailEventId(null);
  };

  const deleteDetailEvent = () => {
    if (!detailEventId) return;
    setEvents((prev) => prev.filter((x) => x.id !== detailEventId));
    setSelectedAiEventIds((prev) => prev.filter((id) => id !== detailEventId));
    setDetailEventId(null);
  };

  if (loading || !storageReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-4 py-6">
        <div className="mx-auto max-w-[1500px]">
          <MainNavButtons />
          <p className="mt-6 text-gray-600">
            {loading ? 'Loading calendar…' : 'Preparing your workspace…'}
          </p>
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

        {sessionAgentDraft ? (
          <div className="mb-4">
            <CalendarAgentPanel
              draft={sessionAgentDraft}
              onDismiss={() => setSessionAgentDraft(null)}
              onEventsConfirmed={(confirmed) => {
                setEvents((prev) => [
                  ...prev,
                  ...confirmed.map(
                    (c): CalendarEvent => ({
                      id: c.id,
                      title: c.title,
                      start: c.start,
                      end: c.end,
                      source: 'manual',
                      description: c.description,
                      locked: c.locked ?? false,
                    }),
                  ),
                ]);
                setSessionAgentDraft(null);
                setScheduleCoachNote('Saved blocks from Calendar Agent — drag to adjust if needed.');
              }}
            />
          </div>
        ) : null}

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
                  {visibleWeekCount} events
                </span>
              </div>

              <div className="max-h-[min(420px,52vh)] overflow-auto pt-3">
                <div className="min-h-[280px] min-w-[720px]">
                  <div
                    className="mb-1 grid overflow-hidden rounded-2xl border border-indigo-100/60 bg-gradient-to-b from-white/90 to-violet-50/40"
                    style={{ gridTemplateColumns: '56px repeat(7, minmax(0,1fr))' }}
                  >
                    <div />
                    {days.map((d) => (
                      <div
                        key={d.toISOString()}
                        className={`px-1.5 py-1.5 text-center text-[11px] font-semibold ${
                          isSameDay(d, today) ? 'bg-violet-200/50 text-violet-950' : 'text-gray-700'
                        }`}
                      >
                        <span
                          className={`block text-[9px] font-medium uppercase tracking-wide ${isSameDay(d, today) ? 'text-violet-800' : 'text-gray-500'}`}
                        >
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
                            className={`absolute left-0 right-0 pl-1 text-[9px] tabular-nums ${showLabel ? 'text-gray-400' : 'pointer-events-none text-transparent select-none'}`}
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
                                const conflictFlash = draftPlacement?.id === ev.id && draftPlacement.conflict;
                                return (
                                  <div
                                    key={ev.id}
                                    data-calendar-event={source === 'ai' ? 'ai' : 'busy'}
                                    onMouseDown={(event) => {
                                      if (source !== 'ai') return;
                                      event.stopPropagation();
                                      setCalendarWarning(null);
                                      if (event.metaKey || event.ctrlKey) {
                                        pendingPointerRef.current = null;
                                        setSelectedAiEventIds((prev) =>
                                          prev.includes(ev.id) ? prev.filter((id) => id !== ev.id) : [...prev, ev.id],
                                        );
                                        return;
                                      }
                                      pendingPointerRef.current = {
                                        eventId: ev.id,
                                        clientX: event.clientX,
                                        clientY: event.clientY,
                                        start: ev.start,
                                        end: ev.end,
                                      };
                                    }}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (source === 'ai') return;
                                      setSelectedAiEventIds([]);
                                      setDetailEventId(ev.id);
                                    }}
                                    title={`${ev.title}\n${ev.startLabel}–${ev.endLabel}`}
                                    className={`absolute left-0.5 right-0.5 z-30 overflow-hidden rounded-lg border px-1 py-0.5 text-left leading-tight shadow-sm ${
                                      source === 'uploaded'
                                        ? 'cursor-pointer border-purple-200/80 bg-white/90 text-gray-800 backdrop-blur-sm'
                                        : source === 'ai'
                                          ? conflictFlash
                                            ? 'cursor-grab border-rose-500 bg-rose-500/90 text-white shadow-md'
                                            : isSelected
                                              ? 'cursor-grab border-violet-700 bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20'
                                              : 'cursor-grab border-indigo-400/60 bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-indigo-500/15'
                                          : 'cursor-pointer border-indigo-400/60 bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-indigo-500/15'
                                    }`}
                                    style={{ top: `${ev.topPct}%`, height: `${Math.max(4, ev.heightPct)}%` }}
                                  >
                                    <div className="truncate text-[10px] font-semibold">{ev.title}</div>
                                    {source === 'ai' ? (
                                      <div
                                        onMouseDown={(event) => {
                                          event.stopPropagation();
                                          pendingPointerRef.current = null;
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
                                    ) : null}
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
            {preview && agilityPreviewSidebarHasContent(preview as unknown as AgilityPreviewData) ? (
              <div className={shellCard}>
                <AgilityPreviewSidebar preview={preview as unknown as AgilityPreviewData} variant="sidebar" />
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
                    plannerHydratedRef.current = false;
                    if (storageKeys) {
                      localStorage.removeItem(storageKeys.events);
                      localStorage.removeItem(storageKeys.tasks);
                      localStorage.removeItem(storageKeys.coachOptions);
                    }
                    setCoachBaseOptions(
                      storageUserKey ? loadCoachSchedulerOptions(storageUserKey) : normalizePlannerCoachOptions({}),
                    );
                    setEvents([]);
                    setTasks([]);
                    setUnscheduled([]);
                    setSelectedAiEventIds([]);
                    setAltSuggestion(null);
                    setCalendarWarning(null);
                    setDetailEventId(null);
                    plannerHydratedRef.current = true;
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
                  <SlimeAdvisor size="sm" profile={slimeProfile} state={scheduleCoachBusy ? 'thinking' : 'idle'} className="scale-[0.65] origin-left" />
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

        {detailEventId && detailEvent ? (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-detail-title"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setDetailEventId(null);
            }}
          >
            <div
              className="relative w-full max-w-md rounded-2xl border border-gray-200/90 bg-gray-50/95 p-5 shadow-2xl shadow-slate-900/20"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2 border-b border-gray-200/80 pb-3">
                <div className="min-w-0">
                  <h2 id="event-detail-title" className="text-base font-semibold text-gray-900">
                    Event details
                  </h2>
                  <p className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-500">
                    {detailEvent.source === 'ai' ? 'AI block' : detailEvent.source === 'uploaded' ? 'Imported' : 'Manual'}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-full p-1.5 text-gray-500 hover:bg-gray-200/80 hover:text-gray-800"
                  aria-label="Close event details"
                  onClick={() => setDetailEventId(null)}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <label className="mt-4 block text-[11px] font-medium text-gray-600">Title</label>
              <input
                value={detailTitle}
                onChange={(e) => setDetailTitle(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25"
              />

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-medium text-gray-600">Start</label>
                  <input
                    type="datetime-local"
                    value={detailStartLocal}
                    onChange={(e) => setDetailStartLocal(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-2 py-2 text-xs text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-600">End</label>
                  <input
                    type="datetime-local"
                    value={detailEndLocal}
                    onChange={(e) => setDetailEndLocal(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-2 py-2 text-xs text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25"
                  />
                </div>
              </div>

              <label className="mt-3 block text-[11px] font-medium text-gray-600">Notes</label>
              <textarea
                value={detailDescription}
                onChange={(e) => setDetailDescription(e.target.value)}
                rows={3}
                className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25"
              />

              <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={detailLocked}
                  onChange={(e) => setDetailLocked(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-400/40"
                />
                Locked (schedule coach should avoid moving this block)
              </label>

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-gray-200/80 pt-4">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-800 hover:bg-rose-50"
                  onClick={deleteDetailEvent}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Delete
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:from-indigo-500 hover:to-violet-500"
                  onClick={persistDetailEdits}
                >
                  Save
                </button>
              </div>
              <p className="mt-2 text-[10px] text-gray-500">
                Tip: AI blocks — click to open details; drag to move; drag the bottom edge to resize. ⌘/Ctrl-click to multi-select.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
