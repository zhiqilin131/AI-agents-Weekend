import { useCallback, useLayoutEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { DiaryMonthPicker } from './DiaryMonthPicker';
import { computeRailScrollLeft, formatMonthHeading } from './diaryNavigation';
import type { DiaryMonthDay } from './types';

export type DiaryDateRailProps = {
  selectedDate: string;
  today: string;
  monthDays: DiaryMonthDay[];
  displayMonth: string;
  hasEntryForDate: (iso: string) => boolean;
  onSelectDate: (iso: string) => void;
  onStepDay: (delta: -1 | 1) => void;
  onEnsureMonth: (yearMonth: string) => void;
  onToday: () => void;
};

function parseLocalDate(iso: string): Date {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d);
}

const railBtn =
  'group absolute top-1/2 z-20 flex h-[calc(100%-0.5rem)] w-11 -translate-y-1/2 items-center justify-center rounded-xl border border-white/60 bg-white/75 text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur-md transition-[transform,box-shadow,background-color,border-color] duration-200 hover:border-violet-300/90 hover:bg-white hover:text-violet-800 hover:shadow-[0_10px_28px_rgba(124,58,237,0.12)] active:scale-[0.96]';

export function DiaryDateRail({
  selectedDate,
  today,
  monthDays,
  displayMonth,
  hasEntryForDate,
  onSelectDate,
  onStepDay,
  onEnsureMonth,
  onToday,
}: DiaryDateRailProps) {
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollSelectedIntoView = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const root = scrollRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLElement>(`button[data-date="${selectedDate}"]`);
      if (!el) return;
      const left = computeRailScrollLeft(root.clientWidth, root.scrollWidth, el.offsetLeft, el.offsetWidth);
      if (Math.abs(root.scrollLeft - left) < 2) return;
      root.scrollTo({ left, behavior: reducedMotion ? 'auto' : behavior });
    },
    [reducedMotion, selectedDate],
  );

  useLayoutEffect(() => {
    scrollSelectedIntoView('auto');
    const raf = window.requestAnimationFrame(() => scrollSelectedIntoView(reducedMotion ? 'auto' : 'smooth'));
    return () => window.cancelAnimationFrame(raf);
  }, [selectedDate, displayMonth, monthDays.length, scrollSelectedIntoView, reducedMotion]);

  const monthLabel = formatMonthHeading(displayMonth);
  const selectedLabel = parseLocalDate(selectedDate).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const calendarTrigger = (
    <button
      type="button"
      data-testid="diary-open-calendar"
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-violet-200/80 bg-gradient-to-br from-white to-violet-50/60 px-3 text-left shadow-[0_2px_12px_rgba(124,58,237,0.08)] transition hover:border-violet-300 hover:shadow-[0_6px_20px_rgba(124,58,237,0.12)] active:scale-[0.98]"
      aria-label="Open calendar"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600/10 text-violet-700">
        <CalendarDays className="h-4 w-4" strokeWidth={2} aria-hidden />
      </span>
      <span className="hidden min-w-0 sm:block">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-600/90">Calendar</span>
        <span className="block truncate text-xs font-medium text-slate-800">{selectedLabel}</span>
      </span>
    </button>
  );

  return (
    <section
      data-testid="diary-date-rail"
      className="mt-5 overflow-hidden rounded-2xl border border-white/90 bg-white/55 shadow-[0_20px_64px_rgba(79,70,229,0.08)] backdrop-blur-xl"
    >
      <motion.div
        layout
        className="flex flex-wrap items-center justify-between gap-3 border-b border-white/75 px-4 py-3.5 sm:px-5"
      >
        <motion.div layout className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-600/95">Timeline</p>
          <p className="mt-0.5 truncate text-base font-semibold tracking-tight text-slate-950">{monthLabel}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Side arrows move by day · open calendar for any date
          </p>
        </motion.div>

        <motion.div layout className="flex items-center gap-2">
          <DiaryMonthPicker
            selectedDate={selectedDate}
            today={today}
            hasEntryForDate={hasEntryForDate}
            onSelectDate={onSelectDate}
            onEnsureMonth={onEnsureMonth}
            trigger={calendarTrigger}
          />
          <button
            type="button"
            onClick={onToday}
            className="h-10 rounded-xl border border-slate-200/90 bg-white/90 px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-violet-300 hover:text-violet-800 active:scale-[0.98]"
          >
            Today
          </button>
        </motion.div>
      </motion.div>

      <motion.div layout className="relative px-2 pb-3 pt-2 sm:px-3">
        <button
          type="button"
          className={`${railBtn} left-1 sm:left-1.5`}
          aria-label="Previous day"
          title="Previous day"
          onClick={() => onStepDay(-1)}
        >
          <ChevronLeft className="h-5 w-5 transition group-hover:-translate-x-0.5" strokeWidth={2.25} aria-hidden />
        </button>
        <button
          type="button"
          className={`${railBtn} right-1 sm:right-1.5`}
          aria-label="Next day"
          title="Next day"
          onClick={() => onStepDay(1)}
        >
          <ChevronRight className="h-5 w-5 transition group-hover:translate-x-0.5" strokeWidth={2.25} aria-hidden />
        </button>

        <div
          ref={scrollRef}
          className="diary-date-rail-scroll mx-10 flex gap-1.5 overflow-x-auto overscroll-x-contain px-1 py-1 scroll-smooth sm:mx-12"
          style={{ scrollSnapType: 'x proximity' }}
        >
          {monthDays.map((d) => {
            const date = parseLocalDate(d.date);
            const selected = selectedDate === d.date;
            const isToday = today === d.date;
            const dayNum = date.getDate();

            return (
              <motion.button
                key={d.date}
                type="button"
                layout={!reducedMotion}
                data-date={d.date}
                data-has-entry={d.has_entry ? 'true' : 'false'}
                data-selected={selected ? 'true' : 'false'}
                aria-current={selected ? 'date' : undefined}
                aria-label={`${d.date}${d.has_entry ? ', diary entry' : ', no entry'}${isToday ? ', today' : ''}`}
                onClick={() => onSelectDate(d.date)}
                whileTap={reducedMotion ? undefined : { scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                style={{ scrollSnapAlign: 'center' }}
                className={`group relative z-[1] flex w-[3.2rem] shrink-0 flex-col items-center rounded-xl border px-1 py-2.5 text-center transition-[border-color,background-color,box-shadow] duration-300 sm:w-[3.45rem] ${
                  selected
                    ? 'border-violet-400/90 bg-gradient-to-b from-violet-50/95 to-white text-slate-950 shadow-[0_10px_28px_rgba(124,58,237,0.14)] ring-1 ring-violet-200/80'
                    : d.has_entry
                      ? 'border-cyan-200/60 bg-white/88 text-slate-800 hover:border-violet-300/70'
                      : 'border-transparent bg-white/40 text-slate-500 hover:border-slate-200/80 hover:bg-white/85'
                }`}
              >
                <span
                  className={`text-[9px] font-semibold uppercase tracking-[0.12em] ${
                    selected ? 'text-violet-600/90' : 'text-slate-400'
                  }`}
                >
                  {date.toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <span className={`mt-0.5 text-lg font-semibold tabular-nums ${selected ? 'text-slate-950' : ''}`}>
                  {dayNum}
                </span>
                <span className="mt-1.5 flex h-1.5 items-center justify-center" aria-hidden>
                  {d.has_entry ? (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        selected ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]' : 'bg-cyan-300/90'
                      }`}
                    />
                  ) : (
                    <span className="h-1 w-1 rounded-full bg-slate-200/70" />
                  )}
                </span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </section>
  );
}
