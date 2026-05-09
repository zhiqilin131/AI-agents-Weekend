import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiaryTrackViewport } from './DiaryTrackViewport';

const eleven = Array.from({ length: 11 }, (_, i) => {
  const day = String(i + 1).padStart(2, '0');
  return { date: `2026-05-${day}`, has_entry: i === 5 };
});

describe('DiaryTrackViewport', () => {
  it('renders only the visible window count', () => {
    const html = renderToStaticMarkup(
      <DiaryTrackViewport
        visibleDays={eleven}
        selectedDate="2026-05-06"
        onSelectDate={() => {}}
        landingRippleDate={null}
        reducedMotion
        jumpPhase="idle"
        jumpSegment={null}
        viewportWidth={560}
      />,
    );
    expect(html).toContain('data-visible-count="11"');
    expect(html).toContain('data-testid="diary-journey-path"');
    expect(html.includes('d="M ') || html.includes('d="m ')).toBe(true);
  });
});
