import { addDays, addMonths, format } from 'date-fns';
import type { DiaryMonthDay } from './types';

/** Calendar step in local noon (DST-safe enough for diary dates). */
export function shiftCalendarDay(isoDate: string, delta: number): string {
  return format(addDays(new Date(`${isoDate}T12:00:00`), delta), 'yyyy-MM-dd');
}

/** Sliding window of ISO dates around the selection (inclusive). */
export function buildVisibleDateWindow(selectedDate: string, radius = 5): string[] {
  const out: string[] = [];
  for (let i = -radius; i <= radius; i++) {
    out.push(shiftCalendarDay(selectedDate, i));
  }
  return out;
}

export function monthsTouchingDates(dates: string[]): string[] {
  return [...new Set(dates.map((d) => d.slice(0, 7)))];
}

/** Move by calendar month clamping day-of-month. */
export function shiftMonthPreserveDay(isoDate: string, deltaMonths: number): string {
  const base = new Date(`${isoDate}T12:00:00`);
  const y = base.getFullYear();
  const mo = base.getMonth();
  const day = base.getDate();
  const nm = new Date(y, mo + deltaMonths, 1);
  const last = new Date(nm.getFullYear(), nm.getMonth() + 1, 0).getDate();
  const d = Math.min(day, last);
  return format(new Date(nm.getFullYear(), nm.getMonth(), d), 'yyyy-MM-dd');
}

function diaryEntryIsoDates(meta: Record<string, DiaryMonthDay | undefined>): string[] {
  return Object.entries(meta)
    .filter(([, v]) => v?.has_entry)
    .map(([k]) => k)
    .sort();
}

/** Next diary day among **loaded** meta keys (wraps). */
export function nextDiaryDateFromMap(meta: Record<string, DiaryMonthDay | undefined>, selectedDate: string): string | null {
  const hits = diaryEntryIsoDates(meta);
  if (!hits.length) return null;
  const nx = hits.find((d) => d > selectedDate);
  return nx ?? hits[0]!;
}

/** Previous diary day among **loaded** meta keys (wraps). */
export function prevDiaryDateFromMap(meta: Record<string, DiaryMonthDay | undefined>, selectedDate: string): string | null {
  const hits = diaryEntryIsoDates(meta);
  if (!hits.length) return null;
  const pr = [...hits].reverse().find((d) => d < selectedDate);
  return pr ?? hits[hits.length - 1]!;
}
