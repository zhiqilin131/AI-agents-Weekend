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

/** All ISO dates in a calendar month (`YYYY-MM`). */
export function buildMonthDateWindow(yearMonth: string): string[] {
  const [y, mo] = yearMonth.split('-').map(Number);
  if (!y || !mo) return [];
  const daysInMonth = new Date(y, mo, 0).getDate();
  const mm = String(mo).padStart(2, '0');
  const out: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    out.push(`${y}-${mm}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

export function formatMonthHeading(yearMonth: string): string {
  const [y, mo] = yearMonth.split('-').map(Number);
  if (!y || !mo) return yearMonth;
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Month grid cells with leading nulls for Sunday-aligned week rows. */
export function buildMonthCalendarCells(yearMonth: string): Array<string | null> {
  const dates = buildMonthDateWindow(yearMonth);
  if (!dates.length) return [];
  const [y, mo] = yearMonth.split('-').map(Number);
  const pad = new Date(y, mo - 1, 1).getDay();
  return [...Array.from<string | null>({ length: pad }).fill(null), ...dates];
}

export function isFutureIsoDate(iso: string, todayIso: string): boolean {
  return iso > todayIso;
}

/** Center a day chip inside a horizontal date rail scroll container. */
export function computeRailScrollLeft(
  containerWidth: number,
  scrollWidth: number,
  itemOffsetLeft: number,
  itemWidth: number,
): number {
  if (containerWidth <= 0 || itemWidth <= 0) return 0;
  const maxScroll = Math.max(0, scrollWidth - containerWidth);
  const ideal = itemOffsetLeft - (containerWidth - itemWidth) / 2;
  return Math.min(maxScroll, Math.max(0, ideal));
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
