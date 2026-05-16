import { describe, expect, it } from 'vitest';
import {
  buildMonthDateWindow,
  buildVisibleDateWindow,
  computeRailScrollLeft,
  formatMonthHeading,
  nextDiaryDateFromMap,
  prevDiaryDateFromMap,
  shiftCalendarDay,
  shiftMonthPreserveDay,
} from './diaryNavigation';
import type { DiaryMonthDay } from './types';

const days: DiaryMonthDay[] = [
  { date: '2026-05-01', has_entry: false },
  { date: '2026-05-02', has_entry: true },
  { date: '2026-05-03', has_entry: false },
  { date: '2026-05-04', has_entry: true },
  { date: '2026-05-05', has_entry: true },
];

const meta = Object.fromEntries(days.map((d) => [d.date, d])) as Record<string, DiaryMonthDay>;

describe('diaryNavigation', () => {
  it('visible window is bounded', () => {
    const w = buildVisibleDateWindow('2026-05-10', 5);
    expect(w).toHaveLength(11);
    expect(w[5]).toBe('2026-05-10');
  });

  it('shiftCalendarDay steps ISO dates', () => {
    expect(shiftCalendarDay('2026-05-01', 1)).toBe('2026-05-02');
  });

  it('next diary wraps among loaded dates', () => {
    expect(nextDiaryDateFromMap(meta, '2026-05-05')).toBe('2026-05-02');
    expect(nextDiaryDateFromMap(meta, '2026-05-01')).toBe('2026-05-02');
  });

  it('prev diary wraps among loaded dates', () => {
    expect(prevDiaryDateFromMap(meta, '2026-05-02')).toBe('2026-05-05');
    expect(prevDiaryDateFromMap(meta, '2026-05-03')).toBe('2026-05-02');
  });

  it('buildMonthDateWindow returns every day in month', () => {
    const may = buildMonthDateWindow('2026-05');
    expect(may).toHaveLength(31);
    expect(may[0]).toBe('2026-05-01');
    expect(may[30]).toBe('2026-05-31');
    const feb = buildMonthDateWindow('2024-02');
    expect(feb).toHaveLength(29);
  });

  it('formatMonthHeading is human readable', () => {
    expect(formatMonthHeading('2026-05')).toMatch(/May/i);
    expect(formatMonthHeading('2026-05')).toMatch(/2026/);
  });

  it('shiftMonthPreserveDay clamps to month end', () => {
    expect(shiftMonthPreserveDay('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('computeRailScrollLeft centers chip and clamps to scroll bounds', () => {
    expect(computeRailScrollLeft(300, 900, 0, 50)).toBe(0);
    expect(computeRailScrollLeft(300, 900, 400, 50)).toBe(275);
    expect(computeRailScrollLeft(300, 900, 850, 50)).toBe(600);
  });
});
