import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import RimumuTherapyLabPage from './RimumuTherapyLabPage';

describe('RimumuTherapyLabPage', () => {
  it('renders lab shell and exercise picks', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RimumuTherapyLabPage />
      </MemoryRouter>,
    );
    expect(html).toContain('Therapy Exercise Lab');
    expect(html).toContain('therapy-lab-pick-breathing_guide');
    expect(html).toContain('Debug panel');
    expect(html).toContain('not diagnosis');
  });
});
