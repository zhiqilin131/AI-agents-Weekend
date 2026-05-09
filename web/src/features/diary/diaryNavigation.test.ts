import { describe, expect, it } from 'vitest';
import { buildVisibleDateWindow, nextDiaryDateFromMap, prevDiaryDateFromMap, shiftCalendarDay } from './diaryNavigation';
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
});
