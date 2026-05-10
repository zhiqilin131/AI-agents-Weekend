import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { HomeRoamingSlime } from './HomeRoamingSlime';

vi.mock('../../../hooks/useSlimeProfile', () => ({
  DEFAULT_SLIME_PROFILE: {
    name: 'Wander',
    colorTheme: 'mint',
    personality: 'playful',
    shape: 'orb',
    accessory: 'spark',
    motion: 'expressive',
    updated_at: '',
  },
  useSlimeProfile: () => ({
    slimeProfile: {
      name: 'Wander',
      colorTheme: 'mint',
      personality: 'playful',
      shape: 'orb',
      accessory: 'spark',
      motion: 'expressive',
      updated_at: '',
    },
    isLoading: false,
    error: null,
    updateSlimeProfile: vi.fn(),
    resetSlimeProfile: vi.fn(),
    refreshSlimeProfile: vi.fn(),
  }),
}));

describe('HomeRoamingSlime', () => {
  it('renders roaming overlay and slime advisor', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HomeRoamingSlime />
      </MemoryRouter>,
    );
    expect(html).toContain('data-testid="home-roaming-slime"');
    expect(html).toContain('data-testid="slime-advisor"');
    expect(html).toContain('pointer-events-none');
    expect(html).toContain('home-roaming-slime-hit');
  });

  it('keeps outer overlay non-interactive for pass-through clicks', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HomeRoamingSlime />
      </MemoryRouter>,
    );
    const outerIdx = html.indexOf('data-testid="home-roaming-slime"');
    expect(outerIdx).toBeGreaterThan(-1);
    const slice = html.slice(Math.max(0, outerIdx - 80), outerIdx + 120);
    expect(slice).toMatch(/pointer-events-none/);
  });

  it('supports auth variant for sign-in layout', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HomeRoamingSlime variant="auth" />
      </MemoryRouter>,
    );
    expect(html).toContain('data-testid="home-roaming-slime"');
    expect(html).toContain('data-testid="slime-advisor"');
  });
});
