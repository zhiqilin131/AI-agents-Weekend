import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import SlimeCompanionPage from './SlimeCompanionPage';

vi.mock('../app/components/credits/SlimeCreditsContext', () => ({
  useSlimeCredits: () => ({
    credits: {
      balance: 10,
      lifetime_granted: 10,
      lifetime_used: 0,
      limits_enabled: true,
      is_admin: false,
      is_unlimited: false,
      display_balance: 10,
    },
    loading: false,
    refresh: vi.fn(),
    showInsufficient: vi.fn(),
  }),
  SlimeCreditsChipNav: () => null,
  SlimeCreditsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../app/components/MainNavButtons', () => ({
  MainNavButtons: () => null,
}));

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
    expect(html).toContain('data-testid="buddy-recent-chat-panel"');
    expect(html).not.toContain('data-testid="slime-buddy-open-chat"');
    expect(html).toContain('data-testid="buddy-left-rail"');
    expect(html).toContain('data-testid="buddy-left-rail-actions"');
    expect(html).toContain('data-testid="buddy-companion-switch"');
    expect(html).toContain('Mochi');
    expect(html).toContain('Rimumu');
    expect(html).toContain('Talk to Mochi');
    expect(html).toContain('data-testid="slime-decision-mode-toggle"');
    expect(html).toContain('data-testid="buddy-voice-dock"');
    expect(html).toMatch(/buddy-voice-dock[^>]*fixed/);
  });
});
