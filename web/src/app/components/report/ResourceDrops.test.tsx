import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResourceDrop } from '../../model';
import { RESOURCE_DROP_CALENDAR_ID } from '../../model';
import { ResourceDrops } from './ResourceDrops';

const sample: ResourceDrop[] = [
  {
    id: RESOURCE_DROP_CALENDAR_ID,
    title: 'Create Execution Calendar',
    description: '',
    url: null,
    action_type: 'calendar',
    source: 'internal',
    relevance_reason: 'Plan',
    confidence: 1,
    domain: null,
  },
  {
    id: 'ext1',
    title: 'Official guide',
    description: 'Body',
    url: 'https://example.gov/a',
    action_type: 'official_page',
    source: 'tavily',
    relevance_reason: 'Match',
    confidence: 0.8,
    domain: 'example.gov',
  },
  {
    id: 'ext2',
    title: 'Second',
    description: 'D',
    url: 'https://example.gov/b',
    action_type: 'search_result',
    source: 'tavily',
    relevance_reason: 'Match',
    confidence: 0.7,
    domain: 'example.gov',
  },
];

describe('ResourceDrops', () => {
  it('shows at most two chips before +more', () => {
    const html = renderToStaticMarkup(
      <ResourceDrops drops={sample} loading={false} onInternalCalendar={vi.fn()} />,
    );
    expect((html.match(/resource-chip-external/g) || []).length).toBeLessThanOrEqual(2);
    expect(html).toContain('+1 more');
  });

  it('hides section when empty and not loading', () => {
    const html = renderToStaticMarkup(<ResourceDrops drops={[]} loading={false} onInternalCalendar={vi.fn()} />);
    expect(html).not.toContain('resource-drops');
  });

  it('shows loading copy while fetching', () => {
    const html = renderToStaticMarkup(<ResourceDrops drops={[]} loading onInternalCalendar={vi.fn()} />);
    expect(html).toContain('Finding useful resources');
  });
});
