import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Brain,
  CalendarClock,
  CalendarDays,
  Compass,
  FileText,
  Link2,
  MessageCircle,
  Mic,
  Sparkles,
} from 'lucide-react';
import { MainNavButtons } from '../app/components/MainNavButtons';
import { DiaryDateRail } from '../features/diary/DiaryDateRail';
import { DiaryEntryCard } from '../features/diary/DiaryEntryCard';
import { useDiaryKeyboardShortcuts } from '../features/diary/DiaryKeyboardShortcuts';
import {
  buildMonthDateWindow,
  monthsTouchingDates,
  nextDiaryDateFromMap,
  prevDiaryDateFromMap,
  shiftCalendarDay,
} from '../features/diary/diaryNavigation';
import type { DiaryEntryDto, DiaryMonthDay, DiarySourceCounts } from '../features/diary/types';
import { useSlimeCredits } from '../app/components/credits/SlimeCreditsContext';
import { ModelSelector } from '../features/models/ModelSelector';
import { buildCheaperModelHint } from '../features/models/slimeModelsApi';
import { useSlimeModelCatalog } from '../features/models/useSlimeModelCatalog';
import { apiFetch } from '../utils/apiFetch';
import { apiFetchErrorMessage } from '../utils/apiOrigin';

function formatShortDate(iso: string): string {
  const [y, mo, d] = iso.split('-').map(Number);
  if (!y || !mo || !d) return iso;
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function totalSources(sc: DiarySourceCounts | null | undefined): number {
  if (!sc) return 0;
  return sc.chat_messages + sc.voice_turns + sc.reports + sc.calendar_items + sc.memory_refs + sc.imported_items;
}

function sourceMix(sc: DiarySourceCounts | null | undefined) {
  const c = sc ?? {
    chat_messages: 0,
    voice_turns: 0,
    reports: 0,
    calendar_items: 0,
    memory_refs: 0,
    imported_items: 0,
  };
  return [
    { label: 'Chat', value: c.chat_messages, Icon: MessageCircle },
    { label: 'Voice', value: c.voice_turns, Icon: Mic },
    { label: 'Reports', value: c.reports, Icon: FileText },
    { label: 'Calendar', value: c.calendar_items, Icon: CalendarClock },
    { label: 'Memory', value: c.memory_refs, Icon: Brain },
    { label: 'Imports', value: c.imported_items, Icon: Link2 },
  ];
}

export default function DiaryPage() {
  const { showInsufficient, refresh: refreshCredits } = useSlimeCredits();
  const slimeModels = useSlimeModelCatalog();
  const [diaryModelOptionId, setDiaryModelOptionId] = useState('');
  useEffect(() => {
    if (slimeModels.ready && slimeModels.defaultModel && !diaryModelOptionId) {
      setDiaryModelOptionId(slimeModels.defaultModel);
    }
  }, [slimeModels.ready, slimeModels.defaultModel, diaryModelOptionId]);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [selectedDate, setSelectedDate] = useState<string>(today);

  const [dayMeta, setDayMeta] = useState<Record<string, DiaryMonthDay>>({});
  const fetchedMonthsRef = useRef<Set<string>>(new Set());

  const [entry, setEntry] = useState<DiaryEntryDto | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [sourceCounts, setSourceCounts] = useState<DiarySourceCounts | null>(null);
  const [loadingSources, setLoadingSources] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [entryErr, setEntryErr] = useState<string | null>(null);

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

  const displayMonth = selectedDate.slice(0, 7);
  const monthDates = useMemo(() => buildMonthDateWindow(displayMonth), [displayMonth]);

  const monthDays = useMemo(
    () => monthDates.map((d) => dayMeta[d] ?? { date: d, has_entry: false }),
    [monthDates, dayMeta],
  );

  useEffect(() => {
    const months = monthsTouchingDates([...monthDates, selectedDate]);
    for (const m of months) void fetchMonth(m);
  }, [selectedDate, monthDates, fetchMonth]);

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

  useEffect(() => {
    let cancelled = false;
    setLoadingSources(true);
    setSourceCounts(null);
    void apiFetch(`/api/diary/sources/${encodeURIComponent(selectedDate)}?timezone=${encodeURIComponent(tz)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as { source_counts?: DiarySourceCounts };
      })
      .then((j) => {
        if (!cancelled) setSourceCounts(j.source_counts ?? null);
      })
      .catch(() => {
        if (!cancelled) setSourceCounts(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingSources(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, tz]);

  const handleSelectDate = useCallback((d: string) => {
    setSelectedDate(d);
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
      const diaryCredit =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `diary-${Date.now()}`;
      const r = await apiFetch('/api/diary/regenerate-cleaner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Credit-Request-Id': diaryCredit,
        },
        body: JSON.stringify({
          date: selectedDate,
          timezone: tz,
          confirm_replace: Boolean(entry.user_edited),
          ...(diaryModelOptionId ? { model_option_id: diaryModelOptionId } : {}),
        }),
      });
      const j = (await r.json()) as {
        empty?: boolean;
        entry?: DiaryEntryDto;
        detail?: string;
      };
      if (r.status === 402) {
        const mid = diaryModelOptionId || slimeModels.defaultModel || 'little';
        const cheaperHint =
          slimeModels.models.length > 0
            ? await buildCheaperModelHint('diary_generate', mid, slimeModels.models)
            : undefined;
        showInsufficient({
          required: Number((j as { required?: number }).required ?? 0),
          balance:
            typeof (j as { balance?: unknown }).balance === 'number'
              ? ((j as { balance?: number }).balance as number)
              : null,
          message:
            typeof (j as { message?: string }).message === 'string'
              ? (j as { message: string }).message
              : 'You need more Slime Credits for this action.',
          cheaperHint,
        });
        return;
      }
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
      void refreshCredits();
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
      const diaryCredit =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `diary-${Date.now()}`;
      const r = await apiFetch('/api/diary/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Credit-Request-Id': diaryCredit,
        },
        body: JSON.stringify({
          date: selectedDate,
          timezone: tz,
          force: true,
          ...(diaryModelOptionId ? { model_option_id: diaryModelOptionId } : {}),
        }),
      });
      const j = (await r.json()) as {
        empty?: boolean;
        entry?: DiaryEntryDto;
        source_counts?: Record<string, unknown>;
        source_diagnostics?: Record<string, unknown>;
        detail?: string;
        required?: number;
        balance?: number;
        message?: string;
      };
      if (r.status === 402) {
        const mid = diaryModelOptionId || slimeModels.defaultModel || 'little';
        const cheaperHint =
          slimeModels.models.length > 0
            ? await buildCheaperModelHint('diary_generate', mid, slimeModels.models)
            : undefined;
        showInsufficient({
          required: Number(j.required ?? 0),
          balance: typeof j.balance === 'number' ? j.balance : null,
          message:
            typeof j.message === 'string' ? j.message : 'You need more Slime Credits for this action.',
          cheaperHint,
        });
        return;
      }
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.statusText);
      if (j.empty) {
        setEntry(null);
        setEntryErr('No activity found for this day.');
      } else if (j.entry) {
        setEntry(j.entry);
      }
      void refreshCredits();
      const ym = selectedDate.slice(0, 7);
      fetchedMonthsRef.current.delete(ym);
      await fetchMonth(ym);
    } catch (e) {
      setEntryErr(apiFetchErrorMessage(e));
    } finally {
      setGenBusy(false);
    }
  }

  const loadedEntryCount = useMemo(() => Object.values(dayMeta).filter((d) => d.has_entry).length, [dayMeta]);
  const visibleEntryCount = monthDays.filter((d) => d.has_entry).length;
  const activeCounts = entry?.source_counts ?? sourceCounts;
  const activeSourceTotal = totalSources(activeCounts);
  const statusLabel = entry
    ? 'Distilled'
    : loadingSources
      ? 'Scanning'
      : activeSourceTotal > 0
        ? 'Ready'
        : 'Quiet';
  const sourceRows = sourceMix(activeCounts);
  const maxSourceValue = Math.max(1, ...sourceRows.map((r) => r.value));

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f8fbff] pb-24 pt-7 text-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(248,250,252,0.92),rgba(237,233,254,0.58)_42%,rgba(236,254,255,0.56)_72%,rgba(255,255,255,0.95))]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.32] [background-image:linear-gradient(rgba(124,58,237,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.09)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:linear-gradient(to_bottom,black,transparent_82%)]" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <MainNavButtons layout="topbar" className="mb-7" />

        <header>
          <div>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              Diary Journey
            </h1>
          </div>
        </header>

        {listErr ? <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{listErr}</p> : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Selected', value: formatShortDate(selectedDate), Icon: CalendarDays },
            { label: 'State', value: statusLabel, Icon: Sparkles },
            { label: 'Loaded days', value: String(loadedEntryCount), Icon: BookOpen },
            { label: 'This month', value: `${visibleEntryCount}/${monthDays.length}`, Icon: Compass },
          ].map(({ label, value, Icon }) => (
            <div key={label} className="rounded-lg border border-white/85 bg-white/72 px-4 py-3 shadow-sm backdrop-blur-md">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                <Icon className="h-4 w-4 text-violet-500" aria-hidden />
              </div>
              <p className="mt-2 text-lg font-semibold tracking-tight text-slate-950">{value}</p>
            </div>
          ))}
        </section>

        <DiaryDateRail
          selectedDate={selectedDate}
          today={today}
          monthDays={monthDays}
          displayMonth={displayMonth}
          hasEntryForDate={(d) => Boolean(dayMeta[d]?.has_entry)}
          onSelectDate={handleSelectDate}
          onStepDay={stepCalendarDay}
          onEnsureMonth={(ym) => void fetchMonth(ym)}
          onToday={() => handleSelectDate(today)}
        />

        <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <DiaryEntryCard
            entry={entry}
            loading={loadingEntry}
            apiError={entryErr}
            selectedDate={selectedDate}
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

          <aside className="space-y-4">
            <section className="rounded-lg border border-white/85 bg-white/74 p-4 shadow-[0_18px_60px_rgba(79,70,229,0.09)] backdrop-blur-xl">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Generation model</p>
              <ModelSelector
                feature="diary_generate"
                selectedModelId={diaryModelOptionId || slimeModels.defaultModel}
                onChange={setDiaryModelOptionId}
                models={slimeModels.models}
                selectorEnabled={slimeModels.selectorEnabled}
                showCostPreview={false}
                variant="compact"
                elevated={false}
                hideCompactHeader
                compactSelectAriaLabel="Diary model tier"
                disabled={genBusy || regenBusy}
              />
            </section>

            <section className="rounded-lg border border-white/85 bg-white/74 p-4 shadow-[0_18px_60px_rgba(79,70,229,0.09)] backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Signal mix</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">{activeSourceTotal} timestamped items</p>
                </div>
                <Sparkles className="h-4 w-4 text-violet-500" aria-hidden />
              </div>
              <div className="space-y-3">
                {sourceRows.map(({ label, value, Icon }) => (
                  <div key={label}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-violet-500" aria-hidden />
                        {label}
                      </span>
                      <span className="font-semibold text-slate-800">{value}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
                        style={{ width: value > 0 ? `${Math.max(6, Math.round((value / maxSourceValue) * 100))}%` : '0%' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </div>
  );
}
