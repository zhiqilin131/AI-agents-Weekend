import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../app/components/ui/popover';
import {
  buildMonthCalendarCells,
  formatMonthHeading,
  isFutureIsoDate,
  shiftMonthPreserveDay,
} from './diaryNavigation';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

export type DiaryMonthPickerProps = {
  selectedDate: string;
  today: string;
  hasEntryForDate: (iso: string) => boolean;
  onSelectDate: (iso: string) => void;
  onEnsureMonth: (yearMonth: string) => void;
  trigger: ReactNode;
};

export function DiaryMonthPicker({
  selectedDate,
  today,
  hasEntryForDate,
  onSelectDate,
  onEnsureMonth,
  trigger,
}: DiaryMonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => selectedDate.slice(0, 7));

  useEffect(() => {
    if (open) setViewMonth(selectedDate.slice(0, 7));
  }, [open, selectedDate]);

  useEffect(() => {
    if (!open) return;
    onEnsureMonth(viewMonth);
  }, [open, viewMonth, onEnsureMonth]);

  const cells = useMemo(() => buildMonthCalendarCells(viewMonth), [viewMonth]);
  const heading = formatMonthHeading(viewMonth);

  const pick = (iso: string) => {
    if (isFutureIsoDate(iso, today)) return;
    onSelectDate(iso);
    setOpen(false);
  };

  const shiftViewMonth = (delta: -1 | 1) => {
    const anchor = `${viewMonth}-15`;
    setViewMonth(shiftMonthPreserveDay(anchor, delta).slice(0, 7));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        data-testid="diary-month-picker"
        className="w-[min(100vw-2rem,20rem)] rounded-2xl border border-violet-100/90 bg-white/95 p-3 shadow-[0_24px_64px_rgba(79,70,229,0.14)] backdrop-blur-xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <button
            type="button"
            aria-label="Previous month"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-700 transition hover:border-violet-300 hover:bg-violet-50/80 active:scale-95"
            onClick={() => shiftViewMonth(-1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <p className="min-w-0 truncate text-center text-sm font-semibold tracking-tight text-slate-900">
            {heading}
          </p>
          <button
            type="button"
            aria-label="Next month"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-700 transition hover:border-violet-300 hover:bg-violet-50/80 active:scale-95"
            onClick={() => shiftViewMonth(1)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-2.5 grid grid-cols-7 gap-0.5">
          {WEEKDAYS.map((wd) => (
            <span
              key={wd}
              className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            >
              {wd}
            </span>
          ))}
          {cells.map((iso, i) => {
            if (!iso) {
              return <span key={`pad-${i}`} aria-hidden />;
            }
            const selected = iso === selectedDate;
            const isToday = iso === today;
            const future = isFutureIsoDate(iso, today);
            const hasEntry = hasEntryForDate(iso);
            const dayNum = Number(iso.slice(8, 10));

            return (
              <button
                key={iso}
                type="button"
                disabled={future}
                data-date={iso}
                data-selected={selected ? 'true' : 'false'}
                aria-label={iso}
                aria-current={selected ? 'date' : undefined}
                onClick={() => pick(iso)}
                className={`relative flex h-9 w-full items-center justify-center rounded-lg text-sm font-medium tabular-nums transition duration-200 ${
                  future
                    ? 'cursor-not-allowed text-slate-300'
                    : selected
                      ? 'bg-violet-600 text-white shadow-[0_4px_14px_rgba(124,58,237,0.35)]'
                      : isToday
                        ? 'bg-violet-50 text-violet-900 ring-1 ring-violet-200/90 hover:bg-violet-100'
                        : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {dayNum}
                {hasEntry && !future ? (
                  <span
                    className={`absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${
                      selected ? 'bg-cyan-200' : 'bg-cyan-400'
                    }`}
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
