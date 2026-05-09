import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import SlimeCompanionPage from './SlimeCompanionPage';

vi.mock('../hooks/useSlimeProfile', () => ({
  DEFAULT_SLIME_PROFILE: {
    name: 'Mochi',
    colorTheme: 'violet',
    personality: 'calm',
    shape: 'classic',
    accessory: 'none',
    motion: 'normal',
    updated_at: '',
  },
  useSlimeProfile: () => ({
    slimeProfile: {
      name: 'Mochi',
      colorTheme: 'violet',
      personality: 'calm',
      shape: 'classic',
      accessory: 'none',
      motion: 'normal',
      updated_at: '',
    },
    isLoading: false,
    error: null,
    updateSlimeProfile: vi.fn(),
    resetSlimeProfile: vi.fn(),
    refreshSlimeProfile: vi.fn(),
  }),
}));

describe('SlimeCompanionPage', () => {
  it('renders stage and personalize affordances', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SlimeCompanionPage />
      </MemoryRouter>,
    );
    expect(html).toContain('data-testid="slime-advisor"');
    expect(html).toContain('Tap the slime');
    expect(html).toContain('Personalize');
    expect(html).toContain('Talk to Mochi');
  });
});
