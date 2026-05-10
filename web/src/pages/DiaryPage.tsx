import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MainNavButtons } from '../app/components/MainNavButtons';
import { DiaryEntryCard } from '../features/diary/DiaryEntryCard';
import { useDiaryKeyboardShortcuts } from '../features/diary/DiaryKeyboardShortcuts';
import {
  buildVisibleDateWindow,
  monthsTouchingDates,
  nextDiaryDateFromMap,
  prevDiaryDateFromMap,
  shiftCalendarDay,
  shiftMonthPreserveDay,
} from '../features/diary/diaryNavigation';
import { DiaryTrackViewport, diarySlotAnchorForDate } from '../features/diary/DiaryTrackViewport';
import { DiarySlimeWalker } from '../features/diary/DiarySlimeWalker';
import type { DiaryEntryDto, DiaryJumpPhase, DiaryMonthDay } from '../features/diary/types';
import { DEFAULT_SLIME_PROFILE, useSlimeProfile } from '../hooks/useSlimeProfile';
import { apiFetch } from '../utils/apiFetch';
import { apiFetchErrorMessage } from '../utils/apiOrigin';

function usePrefersReducedMotion(): boolean {
  const [rm, setRm] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setRm(mq.matches);
    const fn = () => setRm(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return rm;
}

export default function DiaryPage() {
  const { slimeProfile } = useSlimeProfile();
  const profile = slimeProfile ?? DEFAULT_SLIME_PROFILE;
  const reducedMotion = usePrefersReducedMotion();
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [jumpOriginDate, setJumpOriginDate] = useState<string | null>(null);
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  const [dayMeta, setDayMeta] = useState<Record<string, DiaryMonthDay>>({});
  const fetchedMonthsRef = useRef<Set<string>>(new Set());

  const [entry, setEntry] = useState<DiaryEntryDto | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [entryErr, setEntryErr] = useState<string | null>(null);
  const [jumpPhase, setJumpPhase] = useState<DiaryJumpPhase>('idle');
  const [jumpSegment, setJumpSegment] = useState<{ from: number; to: number } | null>(null);

  const vpRef = useRef<HTMLDivElement | null>(null);
  const [vpW, setVpW] = useState(520);

  const mergeDays = useCallback((rows: DiaryMonthDay[]) => {
    setDayMeta((prev) => {
      const n = { ...prev };
      for (const r of rows) n[r.date] = r;
      return n;
    });
  }, []);

  const fetchMonth = useCallback(
    async (monthYm: string) => {
      if (fetchedMonthsRef.current.has(monthYm)) return;
      fetchedMonthsRef.current.add(monthYm);
      setListErr(null);
      try {
        const r = await apiFetch(
          `/api/diary/entries?month=${encodeURIComponent(monthYm)}&timezone=${encodeURIComponent(tz)}`,
        );
        if (!r.ok) throw new Error(await r.text());
        const j = (await r.json()) as { days: DiaryMonthDay[] };
        mergeDays(j.days || []);
      } catch (e) {
        setListErr(apiFetchErrorMessage(e));
        fetchedMonthsRef.current.delete(monthYm);
      }
    },
    [mergeDays, tz],
  );

  const visibleDates = useMemo(() => buildVisibleDateWindow(selectedDate, 5), [selectedDate]);

  const visibleDays = useMemo(
    () => visibleDates.map((d) => dayMeta[d] ?? { date: d, has_entry: false }),
    [visibleDates, dayMeta],
  );

  useEffect(() => {
    const months = monthsTouchingDates([...visibleDates, selectedDate]);
    for (const m of months) void fetchMonth(m);
  }, [selectedDate, visibleDates, fetchMonth]);

  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVpW(el.getBoundingClientRect().width));
    ro.observe(el);
    setVpW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!jumpOriginDate || !selectedDate) {
      setJumpSegment(null);
      return;
    }
    const fromIx = visibleDates.indexOf(jumpOriginDate);
    const toIx = visibleDates.indexOf(selectedDate);
    if (fromIx >= 0 && toIx >= 0 && fromIx !== toIx) {
      setJumpSegment({ from: fromIx, to: toIx });
      const t = window.setTimeout(() => setJumpSegment(null), 1150);
      return () => window.clearTimeout(t);
    }
    setJumpSegment(null);
  }, [jumpOriginDate, selectedDate, visibleDates]);

  const fetchEntry = useCallback(async (date: string) => {
    setLoadingEntry(true);
    setEntryErr(null);
    try {
      const r = await apiFetch(`/api/diary/entries/${encodeURIComponent(date)}`);
      if (r.status === 404) {
        setEntry(null);
        return;
      }
      if (!r.ok) throw new Error(await r.text());
      setEntry((await r.json()) as DiaryEntryDto);
    } catch (e) {
      setEntry(null);
      setEntryErr(apiFetchErrorMessage(e));
    } finally {
      setLoadingEntry(false);
    }
  }, []);

  useEffect(() => {
    void fetchEntry(selectedDate);
  }, [selectedDate, fetchEntry]);

  const [landingRipple, setLandingRipple] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setLandingRipple(selectedDate), reducedMotion ? 60 : 540);
    return () => clearTimeout(t);
  }, [selectedDate, reducedMotion]);

  useEffect(() => {
    if (!landingRipple) return;
    const t = setTimeout(() => setLandingRipple(null), 750);
    return () => clearTimeout(t);
  }, [landingRipple]);

  const handleSelectDate = useCallback((d: string) => {
    const prev = selectedDateRef.current;
    if (prev && prev !== d) {
      setJumpOriginDate(prev);
      window.setTimeout(() => setJumpOriginDate(null), 1150);
    }
    setSelectedDate(d);
    selectedDateRef.current = d;
  }, []);

  const stepCalendarDay = useCallback(
    (delta: -1 | 1) => {
      handleSelectDate(shiftCalendarDay(selectedDate, delta));
    },
    [handleSelectDate, selectedDate],
  );

  useDiaryKeyboardShortcuts({
    enabled: Boolean(selectedDate),
    selectedDate,
    onStepCalendarDay: stepCalendarDay,
    onNextDiaryEntry: () => {
      const n = nextDiaryDateFromMap(dayMeta, selectedDate);
      if (n) handleSelectDate(n);
    },
    onPrevDiaryEntry: () => {
      const p = prevDiaryDateFromMap(dayMeta, selectedDate);
      if (p) handleSelectDate(p);
    },
    onHome: () => handleSelectDate(today),
  });

  async function regenerateCleaner() {
    if (!entry) return;
    if (entry.user_edited && !window.confirm('Replace your edited diary with a freshly distilled entry?')) return;
    setRegenBusy(true);
    setEntryErr(null);
    try {
      const r = await apiFetch('/api/diary/regenerate-cleaner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          timezone: tz,
          confirm_replace: Boolean(entry.user_edited),
        }),
      });
      const j = (await r.json()) as {
        empty?: boolean;
        entry?: DiaryEntryDto;
        detail?: string;
      };
      if (r.status === 409) {
        setEntryErr(typeof j.detail === 'string' ? j.detail : 'Confirmation required to replace edited diary.');
        return;
      }
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.statusText);
      if (j.empty) {
        setEntry(null);
        setEntryErr('No activity found for this day.');
      } else if (j.entry) {
        setEntry(j.entry);
      }
      const ym = selectedDate.slice(0, 7);
      fetchedMonthsRef.current.delete(ym);
      await fetchMonth(ym);
    } catch (e) {
      setEntryErr(apiFetchErrorMessage(e));
    } finally {
      setRegenBusy(false);
    }
  }

  async function generateSelected() {
    setGenBusy(true);
    setEntryErr(null);
    try {
      const r = await apiFetch('/api/diary/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, timezone: tz, force: true }),
      });
      const j = (await r.json()) as {
        empty?: boolean;
        entry?: DiaryEntryDto;
        source_counts?: Record<string, unknown>;
        source_diagnostics?: Record<string, unknown>;
        detail?: string;
      };
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.statusText);
      if (j.empty) {
        setEntry(null);
        setEntryErr('No activity found for this day.');
      } else if (j.entry) {
        setEntry(j.entry);
      }
      const ym = selectedDate.slice(0, 7);
      fetchedMonthsRef.current.delete(ym);
      await fetchMonth(ym);
    } catch (e) {
      setEntryErr(apiFetchErrorMessage(e));
    } finally {
      setGenBusy(false);
    }
  }

  const anchorEnd = diarySlotAnchorForDate(visibleDays, selectedDate);
  const anchorStart = jumpOriginDate ? diarySlotAnchorForDate(visibleDays, jumpOriginDate) : null;

  const displayMonth = selectedDate.slice(0, 7);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-violet-50/40 to-white pb-28 pt-8 text-slate-900">
      <div className="mx-auto max-w-4xl px-4">
        <MainNavButtons className="mb-6" />

        <header className="mb-4 text-center">
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Diary Journey</h1>
            <button
              type="button"
              title="Keyboard: ← → change day · Space next diary entry · Backspace previous diary entry · Home today"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-bold text-slate-500 shadow-sm"
              aria-label="Keyboard shortcuts"
            >
              ?
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            Daily summaries from chats, voice, decisions, and calendar.
          </p>
        </header>

        <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm hover:border-violet-300"
            onClick={() => handleSelectDate(shiftMonthPreserveDay(selectedDate, -1))}
          >
            ← Month
          </button>
          <span className="min-w-[5.5rem] text-center text-sm font-semibold text-slate-800">{displayMonth}</span>
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm hover:border-violet-300"
            onClick={() => handleSelectDate(shiftMonthPreserveDay(selectedDate, 1))}
          >
            Month →
          </button>
          <button
            type="button"
            disabled={genBusy}
            onClick={() => void generateSelected()}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-violet-700 disabled:opacity-50"
          >
            {genBusy ? '…' : 'Generate'}
          </button>
        </div>

        {listErr ? <p className="mb-3 text-center text-sm text-rose-600">{listErr}</p> : null}

        <div ref={vpRef} className="w-full">
          <DiaryTrackViewport
            visibleDays={visibleDays}
            selectedDate={selectedDate}
            onSelectDate={(d) => handleSelectDate(d)}
            landingRippleDate={landingRipple}
            reducedMotion={reducedMotion}
            jumpPhase={jumpPhase}
            jumpSegment={jumpSegment}
            viewportWidth={vpW}
          >
            {anchorEnd ? (
              <DiarySlimeWalker
                anchorStart={anchorStart}
                anchorEnd={anchorEnd}
                reducedMotion={reducedMotion}
                slimeProfile={profile}
                onPhaseChange={(p) => setJumpPhase(p)}
              />
            ) : null}
          </DiaryTrackViewport>
        </div>

        <p className="sr-only" aria-live="polite">
          Jump phase: <span data-testid="diary-jump-phase">{jumpPhase}</span>
        </p>

        <DiaryEntryCard
          entry={entry}
          loading={loadingEntry}
          apiError={entryErr}
          onSavedInsight={() => {
            void fetchEntry(selectedDate);
            const ym = selectedDate.slice(0, 7);
            fetchedMonthsRef.current.delete(ym);
            void fetchMonth(ym);
          }}
          onGenerateFromDay={() => void generateSelected()}
          generateBusy={genBusy}
          onRegenerateCleaner={() => void regenerateCleaner()}
          regenerateBusy={regenBusy}
        />
      </div>
    </div>
  );
}
