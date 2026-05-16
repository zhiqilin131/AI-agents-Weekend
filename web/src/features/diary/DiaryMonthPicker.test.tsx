import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiaryMonthPicker } from './DiaryMonthPicker';

describe('DiaryMonthPicker', () => {
  it('renders calendar trigger', () => {
    const html = renderToStaticMarkup(
      <DiaryMonthPicker
        selectedDate="2026-05-16"
        today="2026-05-16"
        hasEntryForDate={() => false}
        onSelectDate={vi.fn()}
        onEnsureMonth={vi.fn()}
        trigger={<button type="button">Open</button>}
      />,
    );
    expect(html).toContain('Open');
  });
});
