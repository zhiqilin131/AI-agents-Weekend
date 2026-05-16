import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiaryDateRail } from './DiaryDateRail';
import type { DiaryMonthDay } from './types';

const days: DiaryMonthDay[] = Array.from({ length: 31 }, (_, i) => ({
  date: `2026-05-${String(i + 1).padStart(2, '0')}`,
  has_entry: i % 5 === 0,
}));

describe('DiaryDateRail', () => {
  it('renders full month rail with day arrows and calendar trigger', () => {
    const html = renderToStaticMarkup(
      <DiaryDateRail
        selectedDate="2026-05-30"
        today="2026-05-16"
        monthDays={days}
        displayMonth="2026-05"
        hasEntryForDate={(d) => days.some((x) => x.date === d && x.has_entry)}
        onSelectDate={vi.fn()}
        onStepDay={vi.fn()}
        onEnsureMonth={vi.fn()}
        onToday={vi.fn()}
      />,
    );
    expect(html).toContain('data-testid="diary-date-rail"');
    expect(html).toContain('data-date="2026-05-30"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('Previous day');
    expect(html).toContain('Next day');
    expect(html).toContain('data-testid="diary-open-calendar"');
    expect(html).not.toContain('Jump to date');
    expect((html.match(/data-date="/g) || []).length).toBe(31);
  });
});
